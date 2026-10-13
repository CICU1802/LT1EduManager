# Điểm danh và nghiệp vụ liên quan

Bản sửa này bổ sung mã nguồn; không tự chuyển dữ liệu thật, bật PostgreSQL hay triển khai production. Tiếp tục giữ `DATA_BACKEND=sheets` cho đến khi trung tâm quyết định chuyển đổi.

## Phạm vi theo nguồn dữ liệu

| Chức năng | Sheets | PostgreSQL |
| --- | --- | --- |
| Tự tải khi đổi lớp/ngày, tìm kiếm, phân trang, thống kê đi trễ | Có | Có |
| Có mặt, Đi trễ, Vắng, Vắng có phép, Khác, bỏ lựa chọn | Có | Có |
| Ghi chú độc lập với trạng thái | Cell note có cấu trúc, giữ ghi chú cũ | Cột note độc lập |
| Bản nháp thiết bị, cảnh báo rời/tải lại, khôi phục có kiểm tra | Có | Có |
| Chỉ gửi dòng đổi, kiểm tra phiên bản, gửi lại an toàn | Có; giới hạn bên dưới | Giao dịch và khóa giữa các máy chủ |
| Lịch sử người sửa, trước/sau | Tab DB_AttendanceAudit | audit_log |
| Kiểm tra lịch tại máy chủ | Có | Có; lịch chuẩn hóa và ngoại lệ |
| Nhiều ca/ngày, chuyển lớp theo ngày, lịch sử đăng ký | Chưa hỗ trợ | Có |
| Vắng liên tiếp, việc gọi phụ huynh, học bù | Chưa hỗ trợ | Có |
| Duyệt báo học sinh mới thành hồ sơ + đăng ký + điểm danh | Báo cáo chờ xử lý | Giao dịch đồng thời |
| Gia đình, tỷ lệ giảm học phí, kết quả kiểm tra | Chưa hỗ trợ | Có |
| Chuyên cần trong hồ sơ | Chưa đồng bộ về DB_HocSinh | Tính từ điểm danh |
| Excel theo template đã duyệt và tab chi tiết | Chỉ phân tích khi chưa chuyển đổi | Import/export có duyệt |

## Cách dùng điểm danh

1. Chọn lớp, ngày và ca; danh sách tự tải. Chỉ thao tác khi danh sách khớp lựa chọn. Lớp rỗng vẫn báo học sinh mới được.
2. Chọn trạng thái, nhập ghi chú. Có thể đánh dấu Có mặt cho toàn bộ học sinh chưa điểm danh; bộ đếm Đã đến lớp gồm Có mặt + Đi trễ. Tìm kiếm/phân trang không làm mất chỉnh sửa ngoài trang đang xem.
3. Nhấn Lưu. Nếu còn học sinh chưa điểm danh, giao diện yêu cầu xác nhận. Hệ thống chỉ gửi dòng thay đổi và phiên bản đã đọc. Nếu có dòng bị người khác sửa, toàn bộ lần lưu bị từ chối để đối chiếu.
4. Bản nháp tự lưu trong trình duyệt theo tài khoản/lớp/ngày/ca, không phải đã lưu máy chủ. Có thể khôi phục khi phiên bản còn khớp hoặc tải CSV bản nháp để đối chiếu. Nếu trình duyệt chặn lưu, giao diện báo lỗi. Không xóa dữ liệu trình duyệt khi còn bản nháp cần giữ.
5. Sau khi máy chủ xác nhận, giao diện đọc lại và hiển thị thời điểm lưu. Nếu lần đọc lại lỗi, thông báo phân biệt rõ với lỗi ghi. Gửi lại cùng mã yêu cầu không tạo lần lưu trùng.

## Quy tắc nghiệp vụ PostgreSQL

- Admin/văn phòng quản lý lịch, đăng ký, học bù, gia đình, điểm kiểm tra, nhập học và việc gọi phụ huynh. Trợ giảng được đọc/lưu điểm danh và báo học sinh mới. Máy chủ kiểm tra quyền; chưa có phân công quyền theo từng lớp.
- Ngày bắt đầu đăng ký được tính; ngày kết thúc là ngày đầu tiên không còn học. Các khoảng đăng ký không được chồng nhau. Chuyển lớp tạo đăng ký lớp đích trong cùng giao dịch; nếu đã có đăng ký ở đích, phải đối chiếu lịch sử trước. Không khóa chỉnh sửa buổi trước ngày chuyển.
- Ca `default` là buổi thường. Mã ca bổ sung ổn định, có nhãn/giờ và lý do. Văn phòng tạo buổi ngoại lệ khi không thuộc lịch thường. Khi lập nhiều ca cùng ngày, đặt giờ chính xác để tính thứ tự chuyên cần.
- Hai buổi **Vắng** liên tiếp tạo một việc gọi phụ huynh, không tự gửi tin nhắn hay gọi điện. Vắng có phép, Có mặt, Đi trễ hoặc chưa điểm danh ngắt chuỗi. Chỉ xét buổi đã được tạo hoặc có điểm danh; không tự suy ra vắng từ lịch tuần chưa ghi nhận. Sửa lịch sử cập nhật việc đang mở; việc đã hoàn tất không tự mở lại. Ngưỡng hiện tại cố định là 2 buổi.
- Học bù liên kết buổi vắng gốc và buổi đích; không xóa vắng gốc. Học sinh có thể xuất hiện ở lớp đích chỉ cho buổi học bù, không thành đăng ký học thường.
- Duyệt báo học sinh mới: chọn mã hồ sơ đã có hoặc tạo mới; tạo đăng ký và có thể bổ sung trạng thái buổi báo cáo. Không ghi đè điểm danh đã tồn tại.
- Gia đình có tỷ lệ giảm do văn phòng nhập, không tự suy luận từ họ tên/SĐT. Khi gia đình có ít nhất hai hồ sơ, nút gợi ý học phí áp dụng tỷ lệ đó lên mức phí lớp. Đây là gợi ý trước khi lập hóa đơn; không sửa hóa đơn cũ. Hiện chưa loại người đã nghỉ khỏi điều kiện hai hồ sơ.
- Điểm kiểm tra có tên bài, ngày, lớp, điểm và thang điểm; hiển thị trong hồ sơ học sinh.

## Excel

Giữ nguyên template gốc, styles, hình, merge và bố cục. Ca thường đi vào cột ngày cũ; thêm tab `LT1_ChiTiet_*` chứa mã học sinh/lớp/ngày/ca/trạng thái/ghi chú/phiên bản để đối chiếu đầy đủ.

Tab chi tiết là **bản đối chiếu**, chưa hỗ trợ sửa rồi nhập lại từ tab này. Preview cảnh báo rõ. Import template truyền thống vẫn có duyệt danh tính/xung đột; checkbox không thể biểu diễn xóa ghi chú nên giữ ghi chú đã lưu. Sửa hoặc xóa ghi chú, sửa ca bổ sung qua trang Điểm danh. Thay đổi trạng thái chuyển lớp bằng định dạng Excel không sửa các khoảng ngày hiệu lực đã quản lý trên web.

## Vận hành và giới hạn

- Production của cả hai nguồn dữ liệu yêu cầu `AUTH_USERS_JSON` với tài khoản riêng, role hợp lệ và mật khẩu ít nhất 12 ký tự. Cấu hình trước khi deploy, không dùng tài khoản demo. Triển khai frontend/backend cùng phiên bản.
- Nếu sau này bật PostgreSQL: sao lưu, chạy `npm run db:migrate` trong server ở staging trước. Schema v2 chuyển bản ghi cũ sang ca `default`, giữ ghi chú/phiên bản; chạy lặp được. Việc chuyển dữ liệu thật là tác vụ riêng, chưa thực hiện trong PR này. Xem DATABASE_EXCEL.md.
- Sheets có thể cấu hình `ATTENDANCE_SHEET_MAP_JSON` dạng `{"9T-K1":{"spreadsheetId":"...","title":"9T-K1"}}` thay cho suy luận tên lớp. Ghi chú được lưu bằng cell note với khóa `lt1`; không sửa/xóa cấu trúc note này thủ công. App không dùng màu trang trí/gạch ngang để khóa học sinh; cần trạng thái chuyển/nghỉ rõ ràng trong dữ liệu đăng ký.
- Sheets so sánh phiên bản sau khi đọc mới và xếp hàng ghi trong **một tiến trình**. Không bảo đảm loại bỏ cuộc đua giữa nhiều backend hoặc người đang sửa trực tiếp Sheets đúng lúc app ghi. Google Sheets không có compare-and-swap cho thao tác này. Giữ một backend ghi và tránh sửa cùng buổi đồng thời; PostgreSQL mới bảo đảm giao dịch giữa nhiều máy chủ.
- Lịch sử giao diện PostgreSQL giới hạn 500 thay đổi gần nhất cho buổi; dữ liệu audit vẫn được giữ trong DB. Bản nháp chỉ ở thiết bị hiện tại. Lịch sử không thể phục dựng những lần sửa trước khi có cơ chế audit.

## Kiểm thử

- `npm --prefix server test`: giao dịch PostgreSQL bằng PGlite; migration từ v1; stale write/rollback; retry; ca; lịch sử đăng ký; học bù/task; gia đình/điểm; quyền API; Sheets giả lập; Excel xuất-nhập không mất ghi chú.
- `npm --prefix student_management run test:attendance`: render component thật bằng React + jsdom, kiểm tra thay đổi qua phân trang, bản nháp/xung đột, lớp trống và giới hạn giao diện trợ giảng.
- `npm --prefix student_management run build` và `npm --prefix student_management run lint`.
- Bộ Playwright cần Chromium. Môi trường thực hiện PR không tải được Chromium nên chưa xác nhận bố cục/responsive bằng trình duyệt thật, kết nối DB production hoặc ghi vào Sheets thật. Không dùng dữ liệu trung tâm cho các kiểm thử này.
