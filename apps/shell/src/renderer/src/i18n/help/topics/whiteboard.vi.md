# Bảng trắng: động não, phác thảo và chú thích

Trình chỉnh sửa bảng trắng mở các tệp `.whiteboard` trong một thẻ. Bạn có thể sắp xếp giấy ghi chú, văn bản, hình khối, đường nối, bảng, nhãn dán, hình ảnh, thẻ liên kết và nét bút vẽ tự do trên bảng vô hạn hoặc trang cố định, đưa trang PDF làm nền, xuất ra hình ảnh hoặc PDF và làm việc cùng khung AI. Mọi thứ chạy cục bộ trên máy tính của bạn.

## Mở và tạo mới

- Bảng mới bắt đầu dưới dạng bảng tự do vô hạn từ ô **Bảng trắng** trên Trang chủ hoặc từ mục Mới trong menu Tệp.
- Trình chỉnh sửa mở tệp `.whiteboard` từ hộp thoại mở, kéo thả vào cửa sổ, tệp gần đây, cây thư mục, Xem nhanh (Space) hoặc Google Drive. Trên Windows, khi cài đặt GenOffice, ứng dụng được đăng ký mặc định cho `.whiteboard`.
- Tệp Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) được nhập thành bảng trắng mới chưa đặt tên. Tệp gốc không bao giờ bị ghi đè, đóng khi chưa sửa sẽ không hỏi lưu và lần lưu đầu tiên gợi ý tệp `.whiteboard` cùng thư mục. Các phần tử chưa hỗ trợ như nhúng web được bỏ qua kèm thông báo số lượng. Trên Windows, `.excalidraw` chỉ hiện trong mục "Mở bằng".
- Nếu bảng trắng đã mở sẵn, mở lại sẽ đưa thẻ đó lên phía trước.

## Chỉnh sửa và công cụ

- Một tệp `.whiteboard` có thể kết hợp bảng tự do và trang cố định (màn hình 16:9, A4 dọc, A4 ngang hoặc kích thước trang PDF tùy chỉnh) trong thanh trang.
- Công cụ gồm chọn, giấy ghi chú, văn bản có định dạng, tám hình khối, đường nối và mũi tên, bút cảm ứng lực nhấn, bút đánh dấu và tẩy, hình ảnh, bảng, nhãn dán tích hợp và thẻ liên kết.
- Kéo thả tệp `.pdf` vào bảng trắng đang mở hoặc chọn **Nhập PDF** để biến các trang PDF đã chọn thành trang nền cố định để vẽ và dán ghi chú lên trên. Mở `.pdf` từ Trang chủ hoặc menu Tệp vẫn mở bằng trình xem PDF như trước.
- Nhấn F5 hoặc nhấp **Trình chiếu** để hiển thị bảng toàn màn hình và chuyển trang bằng phím mũi tên.
- Ở giao diện tối, thanh công cụ, khung bên và nền ngoài trang chuyển tối, còn màu giấy, giấy ghi chú, hình khối và nét mực giữ nguyên màu gốc của tài liệu.

## Lưu, xuất và in

- Lưu, Lưu thành, Tự động lưu, bản sao khôi phục khi gặp sự cố và kiểm tra xung đột ở chế độ chia đôi hoạt động giống các trình chỉnh sửa khác. Nếu không có thay đổi, tệp sẽ không bị ghi lại.
- Xuất ra PNG, SVG hoặc PDF cho **Tất cả các trang** hoặc **Chỉ trang hiện tại**. Trên bảng tự do, xuất và in tự ôm trọn mọi đối tượng kèm lề hoặc dùng vùng bắt đầu mặc định khi bảng trống.
- In (Ctrl+P) hỗ trợ cả in thường và bố cục nhiều trang nâng cao. Kết quả xuất và in giống hệt nhau ở cả giao diện sáng và tối.

## Khung AI

- Nhờ AI sắp xếp giấy ghi chú, dựng mẫu hội thảo hoặc tổng kết, thêm hình khối, đường nối, bảng hoặc hình ảnh, hay tóm tắt nội dung bảng.
- AI nhận bảng văn bản có cấu trúc của bảng trắng và khi mô hình hỗ trợ hình ảnh sẽ tự động đính kèm ảnh trang hiện tại. Mô hình chỉ đọc văn bản sẽ chạy riêng với bảng văn bản.
- Mỗi lệnh chỉnh sửa của AI là một bước hoàn tác (Ctrl+Z), tô sáng đối tượng vừa đổi trên màn hình mà không làm thay đổi tệp lưu và có nút **Hoàn tác các thay đổi này** trên thẻ trả lời.
- Tệp `.whiteboard` có thể đính kèm trong khung AI của trình chỉnh sửa khác, gọi bằng `@`, tìm kiếm trên Trang chủ, dùng trong **Tạo tài liệu khác từ tài liệu này** (bao gồm chuyển sang Markdown không cần AI) và thao tác qua [lệnh dòng lệnh](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Kết nối internet và thẻ liên kết

- Việc mở, chỉnh sửa, xuất, in, nhập Excalidraw và nhập trang PDF không gửi bất kỳ dữ liệu nào ra internet.
- Nhấp vào thẻ liên kết sẽ mở địa chỉ `http`, `https` hoặc `mailto` bằng trình duyệt mặc định.
- Chỉ khi bạn bật rõ tùy chọn **Lấy tiêu đề và ảnh xem trước** lúc thêm hoặc sửa thẻ liên kết, GenOffice mới kết nối một lần tới trang đó và lưu ảnh xem trước vào bên trong tệp `.whiteboard`.
