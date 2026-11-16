# Thao tác tập tin: đổi tên, xóa, xuất

Chương này nói về các thao tác tập tin dùng chung cho mọi trình soạn thảo; các lựa chọn xuất riêng của từng trình soạn thảo nằm trong chương của nó.

Menu **⋯** của một hàng tập tin (rê chuột lên hàng tập tin) gom các thao tác này:

![Menu ⋯ của một hàng tập tin](img/file-ops.png)

## Đổi tên

Hai lối vào, một bộ kiểm tra duy nhất:

- **⋯ ▸ Đổi tên** trên hàng của Trang chủ.
- **Nhấp đúp vào một thẻ tập tin** để đổi tên tại chỗ (xem [Quản lý thẻ và cửa sổ](help://tabs-and-windows)).

Quy tắc: phần mở rộng được giữ tự động; ký tự không hợp lệ, dấu chấm ở cuối và tên dành riêng (CON/NUL và các tên tương tự) bị từ chối kèm thông báo; trùng tên trong cùng thư mục cũng bị chặn. Tập tin thật trên đĩa được đổi tên, và danh sách gần đây cùng các gắn sao đi theo.

## Xóa

- **⋯ ▸ Xóa** ở Trang chủ: hỏi những tập tin nào, rồi chuyển chúng vào **thùng rác hệ thống**, nơi hệ điều hành có thể khôi phục. GenOffice không giữ thao tác hoàn tác riêng cho việc này — khôi phục là việc của thùng rác, không phải của thông báo.

## Nhân bản

**⋯ ▸ Tạo bản sao** tạo một bản `<name> bản sao` trong cùng thư mục; khi trùng tên, một số thứ tự được thêm vào tự động. Bản sao được thêm vào **Gần đây** thay vì mở sẵn cho bạn — cách một cú nhấp, chứ không nằm ngay trước mặt.

## Lưu và Lưu dưới dạng

- **⌘S / ctrl+S** lưu tập tin hiện tại; một tập tin chưa có tiêu đề sẽ hỏi vị trí và tên trước.
- Ở hầu hết trình soạn thảo, danh sách loại tệp trong hộp thoại Lưu dưới dạng cũng có các định dạng xuất (PDF, hình ảnh, các định dạng tài liệu khác). Chọn một trong số đó chỉ ghi ra một bản sao; tài liệu đang mở và thẻ của nó vẫn gắn với tệp gốc. Ảnh của nhiều trang được tách thành `tên-01.png`, `tên-02.png`, ….
- **Docs**: danh sách Lưu dưới dạng còn có .hwp và .hwpx (Tệp ▸ Xuất dưới dạng tài liệu HWP… cũng vậy). Nếu có gì không chuyển được, như nhận xét, phương trình hay hộp văn bản, bạn sẽ được báo trước khi ghi tệp.
- **Lưu dưới dạng** ghi một tập tin mới và để nguyên tệp gốc; các lần sửa sau đó nhắm vào tập tin mới.
- Mỗi lần lưu đều là nguyên tử (tập tin tạm + đổi tên); thoát giữa chừng lúc đang ghi không làm hỏng tệp.
- Tự động lưu tuân theo công tắc của từng trình soạn thảo; tài liệu mới chưa có tệp riêng chỉ bắt đầu sau lần lưu đầu tiên (xem [Bắt đầu nhanh](help://getting-started)).

## Xuất dưới dạng PDF

- **Docs**: File ▸ Xuất dưới dạng PDF (hoặc nút trên dải ruy-bâng), theo đúng cách ngắt trang hiện tại.
- **Slides**: việc xuất raster hóa từng trang, có thanh tiến trình cho các bộ lớn.
- **Sheets**: việc xuất theo cách ngắt trang in.
- Việc xuất được kết xuất trong một cửa sổ ẩn và lưu vào nơi bạn chọn.

## Xuất sang Word / hình ảnh

- **PDF ▸ Xuất dưới dạng Word…**: biến PDF thành .docx (chuyển đổi tại máy; bố cục phức tạp được xử lý ở mức cố gắng hết sức).
- **Docs** có thể xuất các trang thành hình ảnh (PNG từng trang).

## In

File ▸ In (⌘P/ctrl+P) trong từng trình soạn thảo mở cửa sổ in. Docs, PDF, Sheets, Slides và Markdown có mục **Bố cục trang** trong cửa sổ in vốn có, HWP có mục này trong bản xem trước khi in, còn HTML, sơ đồ tư duy và trình vẽ sơ đồ có nó trong một cửa sổ in nhỏ mới. Nếu không chọn gì trong Bố cục trang, việc in vẫn diễn ra như trước.

- **Cách sắp xếp**: chọn một trong Một trang mỗi tờ, Nhiều trang mỗi tờ (2, 4, 6, 9 hoặc 16), Tập sách nhỏ (đóng gáy bên trái hoặc bên phải), Áp phích (số tờ theo chiều ngang và chiều dọc, phần chồng lên nhau, đường cắt) hoặc Nhãn (mỗi nhãn một trang hoặc cùng một trang trên mọi nhãn, nhãn bắt đầu, khổ A4 thông dụng hoặc tự nhập).
- **Chỉ mặt lẻ, chỉ mặt chẵn, in theo thứ tự ngược**: các mặt được đếm sau khi sắp xếp, theo những mặt thực sự đi ra khỏi máy in. Dùng khi máy in không in được hai mặt: in mặt trước, lật giấy rồi in mặt sau.
- **Thu nhỏ cho vừa giấy**: chỉ thu nhỏ những trang lớn hơn khổ giấy đã chọn; trang nhỏ hơn không được phóng to. Sheets và Markdown dùng các ô khổ giấy và tỉ lệ vốn có.
- **Thang xám và độ phân giải hình**: khi in bằng các tùy chọn của Bố cục trang, mỗi trang được chuyển thành hình rồi mới gửi tới máy in. Độ phân giải chọn trong Tự động, 150, 300 hoặc 600 dpi.
- **Chỉ vùng đã chọn**: Docs và Markdown chỉ in phần chữ đã chọn, chia trang lại từ trang đầu; Slides in các trang chiếu đã chọn, PDF in các trang đã chọn. Sheets vẫn in vùng đã chọn như trước.
- **Sơ đồ bố cục và xem trước kết quả**: sơ đồ cho thấy ngay mỗi số trang nằm ở đâu trên tờ giấy, còn **Xem trước kết quả** cho thấy kết quả thực sự được tạo ra. Dùng **Lưu kết quả đã sắp xếp thành PDF** để in đúng bố cục đó trên máy khác hoặc ở tiệm in.
- **Cửa sổ in của hệ thống**: với tập sách nhỏ, hãy chọn in hai mặt và lật theo cạnh ngắn. Giữ nguyên phạm vi trang và số trang mỗi tờ trong cửa sổ hệ thống.

PDF in theo thứ tự trang và góc xoay hiện tại.

## Tập tin chưa có tiêu đề nằm ở đâu

Vị trí bạn chọn ở lần lưu đầu tiên chính là "nhà" của nó. Trước đó tài liệu chưa có tệp riêng: nội dung chưa lưu chỉ được giữ dưới dạng bản sao khôi phục trong thư mục dữ liệu của ứng dụng, nên vẫn lấy lại được nếu ứng dụng tắt đột ngột (xem [Quản lý thẻ và cửa sổ](help://tabs-and-windows)). Tự động lưu chỉ tiếp quản sau lần lưu đầu tiên ấy.
