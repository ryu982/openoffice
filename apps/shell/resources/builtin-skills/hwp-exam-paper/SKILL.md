---
name: hwp-exam-paper
description: 'Write a test paper (시험지, 원안지) in a Hangul document: fill the school form that is open with its own styles, or build a B4 paper in two columns with a head table, points, choices on tab stops and page numbers.'
metadata:
  ieum-editors: hwp
---

# Writing a test paper (원안지)

For a test paper (시험지, 평가, 고사). A worksheet (학습지) or a quiz sheet is written as an ordinary document: it gets this form (B4, the approval box, points, the page border, the end mark) only when the user asks for it. The tool names below are those of the Hangul editor's AI panel.

Every paper names four things the education office asks of an original (원안): the school, the number of pages, the number of questions, and the points of each question. The head table holds the first three; the points go at the end of each question.

## 1. Settle the questions first

From the request: the school, year and term, the test (중간고사, 기말고사, 수행평가 …), grade and subject, the range, how many questions of each kind and their points. Check that the points add up to the full mark the user gave; if they cannot, ask. Write every question yourself unless the user gave them, and leave the answers out unless the user asks for them.

Write each question as one paragraph that starts with its number and ends with its points: `3. 다음 중 옳은 것은? [4점]`. Its choices follow as paragraphs of their own, starting with ① to ⑤. A passage, a figure or a 〈보기〉 sits between the question and its choices. Sub-questions of a written answer are `(1)`, `(2)` on lines of their own, each with its points. Write formulas as equations (`insert_equations`): put a placeholder `[[1]]`, `[[2]]` … in the text where each one goes.

## 2. When a test-paper form is open, fill it

A form is open when `read_formatting` shows paragraph styles made for questions and choices (names such as 문항, 발문, 선지, 보기) or the text already holds numbered questions with ① choices. Then build nothing anew:

1. Read the styles with `read_formatting` and the questions that are there with `read_document`.
2. Put the new questions after the last choice line of the question before them with `insert_paragraphs` (where "after"), one line per paragraph. Replace the sample questions of the form with yours (`replace_text`), and remove the ones left over with `delete_paragraph` only when the user wants them gone.
3. Give the question lines the form's question style with `format_paragraph` (style), and the choice lines the choice style whose name fits their layout (one on a line, five, three or two on a line) when the form has such styles. Format nothing else: the form's own look carries the rest.
4. Read how the form numbers its lines before you write any number: the questions and choices in `read_document` (and the looks with list in `read_formatting`), the lines of a 〈보기〉 box in `read_table`. A line whose text starts without its number (`3.`, `①`, `ㄱ.`) is numbered by its style on the page: write yours without the number, as the form's sample lines are, and the lines after an inserted one move on by themselves. Typing `ㄱ.` into a 〈보기〉 line the form numbers itself prints it twice. Only where the numbers are typed into the text, type yours and renumber the questions after an inserted one with `replace_text`, from the last to the first.
5. Fill a 〈보기〉 box the form has with `fill_cells`. In a form whose body runs in columns set under its head (changes_within), `insert_table` makes a new 〈보기〉 one column wide where it can read that column's width, and refuses where it cannot; then make it as paragraphs with a border (`format_paragraph` border, sides box) in a style of the form that numbers nothing (its 발문 style): new lines take the style of the line before them, and a question style would number them. Then give the line under the box space_before 6 with `format_paragraph`: the box's bottom line stands below its last line and runs through the next line otherwise (space_after lies inside the box and does not help).
6. Leave the head part, the approval box and the line between the columns as they are. `read_page_layout` says changes_within when the form's head runs in one column over a body in two; that is the form, not a fault. The editor may draw such a form over more pages than Hangul prints it.

A school that writes every paper on its own form can keep that form as a skill with a template document and pick it for the next paper; tell the user so when they ask for their school's form.

## 3. Without a form, build it in this order

Text first, then the columns, then the tables: text written into columns already set runs past the foot of the page in the editor's view, and a table made before the columns keeps the full width of the page.

1. **Page.** `set_page_setup` with paper "B4", margin_left 19, margin_right 19, margin_top 10, margin_bottom 10, margin_header 11 and margin_footer 10.
2. **All the text.** `insert_paragraphs` with where "end": every question with its choices, a line `서술형 문항` before the written-answer questions, their sub-questions, and as the last paragraph `- 끝 -`. Separate the choices that share a line with a tab character (`\t` in the text you pass), never with spaces.
3. **Columns.** `set_columns` with count 2, gap_mm 8 and line "solid". Each column is then 105.5 mm wide.
4. **The look, in one call.** `style_paragraphs`:
   - change 바탕글 to a serif face (함초롬바탕, or the text face the editor's instructions name) of 11 pt, align justify, line_spacing 160;
   - 문항: margin_left 0 and indent -16.5 (the number hangs at the left and the second line starts under the text), space_before 12, keep_with_next; applied with numbered "1.";
   - 선지: margin_left 16.5, space_before 3, and the tab stops of the five-on-a-line layout below; applied with numbered "①";
   - one more choice style for each other layout you use (three and two, two on a line), applied with find to the first line of those choices;
   - 소문항: margin_left 16.5 and indent -16.5; applied with numbered "(1)";
   - 서술형 머리: bold, 12 pt, align center, space_before 16, keep_with_next; applied with find "서술형 문항";
   - 끝 표시: align center, space_before 16; applied with find "- 끝 -".
5. **Equations.** `insert_equations` for every placeholder, in one call.
6. **The head table**, as wide as the page over both columns: `insert_table` with across_columns, where "before", the anchor in the first question, look "grid", size 10, align "center", and these four rows of eight cells:

   | Row | Cells |
   | --- | --- |
   | 1 | the year, term and test (`2026학년도 1학기 중간고사`), "", "", `결재`, `출제 교사`, `부장`, `교감`, `교장` |
   | 2 | grade, subject and school (`제2학년 수학   ○○중학교`), "", "", "", "", "", "", "" |
   | 3 | `학년`, the grade, `반`, "", `번호`, "", `성명`, "" |
   | 4 | `쪽수`, the pages, `문항 수`, the count, `만점`, the full mark, `일시`, the date and period |

   Then three `merge_cells`: row 1 columns 1 to 3, row 2 columns 1 to 3, and rows 1 to 2 of column 4 (the word 결재). Then `format_cells`: size 16 and bold on row 1 column 1, and row_height_mm 14 on row 2 columns 5 to 8, where the teachers sign. Leave the 결재 part out when the user says the school does not use one.
7. **Boxes.** A 〈보기〉 is a one-cell table so that it never splits: `insert_table` with where "after" the question line and rows `[[""]]`, then `fill_cells` with its lines in one text (`〈보 기〉\nㄱ. …\nㄴ. …`), then `format_cells` align "left". A note to check the answer sheet goes in the same kind of box before `- 끝 -`, in words of your own.
8. **Page furniture.** `set_header_footer` with kind "footer" and text `{page} / {pages}`, then `set_page_border` with line "solid".
9. **Pages.** `read_page_layout`. When a question is cut at the foot of a column, start it in the next one with `insert_break` (kind "column"); when the user wants the written-answer part on a page of its own, `insert_break` with kind "page" on `서술형 문항`. Fix the page count in the head table (`fill_cells` with overwrite) when it changed.

### Choices on tab stops

Count the characters of the longest choice, its mark and space included (an equation counts as the width it prints at):

| Longest choice | Layout | Tab stops (at_mm) |
| --- | --- | --- |
| up to 4 | five on one line | 25.8, 45.7, 65.6, 85.6 |
| up to 7 | three on the first line, two on the second | 39, 72.3 |
| up to 11 | two on a line | 55.7 |
| longer | one on a line | none |

The stops are measured from the left edge of the column, so each choice of a layout starts at the same place in every question.

## 4. Check before you answer (required)

Read the document once with `read_document` and go through this list. Fix what fails, then answer.

- The numbers run on without a gap or a repeat, each question ends with its points, and the points add up to the full mark in the head table.
- The head table names the school, the pages, the number of questions and the full mark, and the page count in it is the one `read_page_layout` gives.
- Every choice set has ① to ⑤ once, in order, on the layout its length calls for.
- No equation was typed as text, and no placeholder `[[n]]` is left (equations do not show in `read_document`: `list_equations` lists them).
- `check_layout` reports no cell cut off, and no question is split between two columns.

In your reply say in a few lines what you wrote (the kinds of questions, the pages), which form or look you used, and what the user still has to check: the answers, the date, and the names for the approval box.
