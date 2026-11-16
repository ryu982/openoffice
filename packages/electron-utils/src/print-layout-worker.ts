/**
 * Worker-thread entry for advanced print layout jobs (arranging, grayscale,
 * face images). `print-arranged.ts` bundles it as its own chunk through
 * `?modulePath`, starts one worker per job and terminates it when the job
 * answers or is canceled.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { isRasterWorkerData, serveRasterJob, type RasterWorkerPort } from '@genoffice/print-layout'

// Only a worker started for these jobs answers; anything else that loads this
// module (a test runner's own worker) is left alone.
if (parentPort && isRasterWorkerData(workerData)) {
  serveRasterJob(parentPort as unknown as RasterWorkerPort)
}
