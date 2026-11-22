use std::collections::{HashMap, VecDeque};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

use ieum_parse_sidecar::extract::thumbnail::extract_thumbnail;
use ieum_parse_sidecar::extract::{ExtractOptions, extract_file};
use ieum_parse_sidecar::protocol::{Command, PROTOCOL_VERSION, Request, Response};
use ieum_parse_sidecar::scan::scan_dir;
use ieum_parse_sidecar::tokenize::tokenize_text;

type SharedOutput = Arc<Mutex<BufWriter<io::Stdout>>>;

fn write_response(output: &SharedOutput, response: &Response) -> Result<(), ()> {
    let mut guard = output
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if serde_json::to_writer(&mut *guard, response).is_err()
        || guard.write_all(b"\n").is_err()
        || guard.flush().is_err()
    {
        return Err(());
    }
    Ok(())
}

struct WorkItem {
    request: Request,
    cancelled: Arc<AtomicBool>,
}

struct QueueState {
    queue: VecDeque<WorkItem>,
    active: HashMap<String, Arc<AtomicBool>>,
    closed: bool,
    suppress_output: bool,
}

struct WorkerPool {
    state: Arc<(Mutex<QueueState>, Condvar)>,
    handles: Vec<thread::JoinHandle<()>>,
}

impl WorkerPool {
    fn new(num_workers: usize, output: SharedOutput) -> Self {
        let state = Arc::new((
            Mutex::new(QueueState {
                queue: VecDeque::new(),
                active: HashMap::new(),
                closed: false,
                suppress_output: false,
            }),
            Condvar::new(),
        ));

        let mut handles = Vec::with_capacity(num_workers);
        for idx in 0..num_workers {
            let st = Arc::clone(&state);
            let out = Arc::clone(&output);
            if let Ok(handle) = thread::Builder::new()
                .name(format!("parse-worker-{idx}"))
                .spawn(move || worker_loop(st, out))
            {
                handles.push(handle);
            }
        }

        Self { state, handles }
    }

    fn enqueue(&self, request: Request) {
        let (lock, cv) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        let flag = Arc::new(AtomicBool::new(false));
        st.active.insert(request.request_id.clone(), Arc::clone(&flag));
        st.queue.push_back(WorkItem {
            request,
            cancelled: flag,
        });
        cv.notify_one();
    }

    /// Cancels a queued or in-flight request. If the request is still waiting
    /// in the queue, removes it immediately so the caller receives its
    /// `cancelled` response without waiting for busy workers.
    fn cancel(&self, target_request_id: &str, output: &SharedOutput) -> bool {
        let (lock, _) = &*self.state;
        let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
        let Some(flag) = st.active.get(target_request_id).cloned() else {
            return false;
        };
        flag.store(true, Ordering::Release);
        if let Some(pos) = st
            .queue
            .iter()
            .position(|item| item.request.request_id == target_request_id)
        {
            st.queue.remove(pos);
            st.active.remove(target_request_id);
            drop(st);
            let _ = write_response(
                output,
                &Response::failure(
                    target_request_id.to_owned(),
                    "cancelled",
                    "Request was cancelled by the client.".to_owned(),
                ),
            );
        }
        true
    }

    /// Signals all workers to stop, cancels queued and in-flight tasks when
    /// `cancel_in_flight` is true, and joins all worker threads.
    fn shutdown(self, cancel_in_flight: bool) {
        let (lock, cv) = &*self.state;
        {
            let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
            st.closed = true;
            if cancel_in_flight {
                st.suppress_output = true;
                for flag in st.active.values() {
                    flag.store(true, Ordering::Release);
                }
                st.queue.clear();
            }
            cv.notify_all();
        }
        for handle in self.handles {
            let _ = handle.join();
        }
    }
}

fn worker_loop(state: Arc<(Mutex<QueueState>, Condvar)>, output: SharedOutput) {
    let (lock, cv) = &*state;
    loop {
        let item = {
            let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
            while st.queue.is_empty() && !st.closed {
                st = cv.wait(st).unwrap_or_else(|p| p.into_inner());
            }
            match st.queue.pop_front() {
                Some(item) => item,
                None => break,
            }
        };

        let request_id = item.request.request_id.clone();
        let response = execute_request(item.request, &item.cancelled);

        let suppress_output = {
            let mut st = lock.lock().unwrap_or_else(|p| p.into_inner());
            st.active.remove(&request_id);
            st.suppress_output
        };

        if suppress_output {
            continue;
        }
        if write_response(&output, &response).is_err() {
            break;
        }
    }
}

fn execute_request(request: Request, cancelled: &AtomicBool) -> Response {
    let request_id = request.request_id;
    if cancelled.load(Ordering::Acquire) {
        return Response::failure(
            request_id,
            "cancelled",
            "Request was cancelled by the client.".to_owned(),
        );
    }
    if request.version != PROTOCOL_VERSION {
        return Response::failure(
            request_id,
            "unsupported_version",
            "Unsupported sidecar protocol version.".to_owned(),
        );
    }

    match request.command {
        Command::ExtractFile {
            path,
            ext,
            max_chars,
            tokenize,
            max_body_chars,
            redact_namespaces,
        } => {
            let opts = ExtractOptions {
                max_chars,
                tokenize,
                max_body_chars,
                redact_namespaces,
            };
            match extract_file(&path, &ext, &opts, cancelled) {
                Ok(result) => match serde_json::to_value(result) {
                    Ok(v) => Response::success(request_id, v),
                    Err(e) => Response::failure(request_id, "serialize_error", e.to_string()),
                },
                Err(()) => Response::failure(
                    request_id,
                    "cancelled",
                    "Request was cancelled by the client.".to_owned(),
                ),
            }
        }
        Command::ExtractThumbnail {
            path,
            ext,
            max_bytes,
        } => match extract_thumbnail(&path, &ext, max_bytes, cancelled) {
            Ok(result) => match serde_json::to_value(result) {
                Ok(v) => Response::success(request_id, v),
                Err(e) => Response::failure(request_id, "serialize_error", e.to_string()),
            },
            Err(()) => Response::failure(
                request_id,
                "cancelled",
                "Request was cancelled by the client.".to_owned(),
            ),
        },
        Command::ScanDir {
            root,
            max_depth,
            max_files,
        } => match scan_dir(&root, max_depth, max_files, cancelled) {
            Ok(result) => match serde_json::to_value(result) {
                Ok(v) => Response::success(request_id, v),
                Err(e) => Response::failure(request_id, "serialize_error", e.to_string()),
            },
            Err(()) => Response::failure(
                request_id,
                "cancelled",
                "Request was cancelled by the client.".to_owned(),
            ),
        },
        Command::TokenizeText { text } => {
            let result = tokenize_text(&text);
            match serde_json::to_value(result) {
                Ok(v) => Response::success(request_id, v),
                Err(e) => Response::failure(request_id, "serialize_error", e.to_string()),
            }
        }
        Command::Cancel { .. } => {
            Response::success(request_id, serde_json::json!({ "cancelled": false }))
        }
        Command::Shutdown {} => {
            Response::success(request_id, serde_json::json!({ "shutdown": true }))
        }
    }
}

fn main() {
    let stdin = io::stdin();
    let output: SharedOutput = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
    let num_workers = thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let pool = WorkerPool::new(num_workers, Arc::clone(&output));

    for line in BufReader::new(stdin.lock()).lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                let _ = write_response(
                    &output,
                    &Response::failure(
                        String::new(),
                        "stdin_error",
                        format!("Unable to read sidecar request: {error}"),
                    ),
                );
                break;
            }
        };
        let request: Request = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(error) => {
                if write_response(
                    &output,
                    &Response::failure(
                        String::new(),
                        "invalid_json",
                        format!("Invalid sidecar request: {error}"),
                    ),
                )
                .is_err()
                {
                    break;
                }
                continue;
            }
        };

        if request.version != PROTOCOL_VERSION {
            if write_response(
                &output,
                &Response::failure(
                    request.request_id,
                    "unsupported_version",
                    "Unsupported sidecar protocol version.".to_owned(),
                ),
            )
            .is_err()
            {
                break;
            }
            continue;
        }

        match request.command {
            Command::Cancel { target_request_id } => {
                let cancelled = pool.cancel(&target_request_id, &output);
                if write_response(
                    &output,
                    &Response::success(
                        request.request_id,
                        serde_json::json!({ "cancelled": cancelled }),
                    ),
                )
                .is_err()
                {
                    break;
                }
            }
            Command::Shutdown {} => {
                let _ = write_response(
                    &output,
                    &Response::success(
                        request.request_id,
                        serde_json::json!({ "shutdown": true }),
                    ),
                );
                break;
            }
            _ => {
                pool.enqueue(request);
            }
        }
    }

    // Cancel queued and in-flight work on both explicit shutdown and abrupt
    // parent disconnect (bare stdin EOF / broken pipe) so no orphan work lingers.
    pool.shutdown(true);
}
