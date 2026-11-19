"""Build testing/report/CurlStudio-test-report.html from template.html, the test data below and
screenshots (inlined as data URIs so the report is a single self-contained file).

    python testing/report/build_report.py [screenshot-dir]
"""
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'shots')
B = 'mcp-Claude_Browser-blob-'

IMAGES = {
    'unsaved': '1795095598151-nkdx6q.jpg',
    'queue': '1795095630164-egs30t.jpg',
    'popover': '1795095564371-2aqwvu.jpg',
    'unresolved': '1795095591234-qjo3y2.jpg',
    'resize': '1795095653590-vepctm.jpg',
    'search': '1795095658495-vr155p.jpg',
    'newmenu': '1795096251313-l382id.jpg',
    'login': '1795095558917-jsjjn4.jpg',
    'runner': '1795095767133-21tw2s.jpg',
    'graphql': '1795095798603-9i536t.jpg',
    'curl': '1795095817606-8q0wvf.jpg',
    'ws': '1795095842794-rvn7r4.jpg',
    'sse': '1795095858190-odrurg.jpg',
    'mqtt': '1795095872360-ha353g.jpg',
    'grpc': '1795095891873-1x5dcb.jpg',
    'loadlive': '1795095938678-q6vzf4.jpg',
    'export': '1795096094849-avkp2e.jpg',
    'chartbug': '1795095981824-3322vj.jpg',
    'chartfix': '1795096009739-a6ui6u.jpg',
    'collapsebug': '1795095669179-cqz1nx.jpg',
    'quickaddfix': '1795095742014-hhc8v3.jpg',
    'tabbug': '1795095834640-572gpd.jpg',
    'shiftbug': '1795095909904-5mvxgj.jpg',
    'connerr': '1795095582148-u9znv0.jpg',
    'r2_error': '1795101126699-j4r4lm.jpg',
    'r2_shortcuts': '1795101307760-kq2ctg.jpg',
    'r2_settings': '1795101317590-yh9r93.jpg',
    'r2_graphql': '1795101627307-89dls7.png',
    'r2_body_var': '1795101646531-vo4lvp.png',
    'r2_runner': '1795101701090-7a9jhw.jpg',
    'r2_help': '1795101753235-78ooci.jpg',
    'r2_tabs': '1795101731694-kruf2a.jpg',
}

N = True  # marks test cases for the features added in this round

TC = [
    # Import / environment
    ('TC01', 'Import & môi trường', 'Kéo-thả file collection Postman v2.1 và environment vào hộp thoại Import', 'Import đủ 4 folder, 27 request, auth, script, biến collection, environment “Mock Local”', 'pass'),
    ('TC02', 'Import & môi trường', 'Chọn environment và gửi request dùng {{baseUrl}}', 'Biến được thay đúng, request tới localhost:18090', 'pass'),
    # HTTP
    ('TC03', 'HTTP', 'POST Login (raw JSON có biến), test script và pm.environment.set(token)', '200 OK, 2/2 test qua, token được ghi vào environment', 'pass'),
    ('TC04', 'HTTP', 'Bearer auth kế thừa từ collection (GET /me)', '200, tests “authorized/is demo” qua', 'pass'),
    ('TC05', 'HTTP', 'API key auth trong header', '200 /apikey', 'pass'),
    ('TC06', 'HTTP', 'Query param dùng biến collection {{pageSize}}', 'limit=2, test page size qua', 'pass'),
    ('TC07', 'HTTP', 'Path variable :id lấy từ biến', '/products/1 → 200', 'pass'),
    ('TC08', 'HTTP', 'POST tạo mới + pm.collectionVariables.set(productId)', '201 Created, request PATCH/DELETE sau dùng đúng id mới', 'pass'),
    ('TC09', 'HTTP', 'Validation lỗi 422, PATCH 200, DELETE 204', 'Mã trạng thái và body đúng', 'pass'),
    ('TC10', 'HTTP', 'Body x-www-form-urlencoded (Unicode) và multipart form-data', 'Server echo đúng content-type và dữ liệu', 'pass'),
    ('TC11', 'HTTP', 'Xem trước HTML, XML, JSON Unicode/emoji', 'Preview HTML hiển thị đúng; tiếng Việt/emoji/tiếng Nhật đúng', 'pass'),
    ('TC12', 'HTTP', 'JSON 1,09 MB (20.000 dòng)', 'Hiển thị Pretty sau ~164 ms, cuộn mượt', 'pass'),
    ('TC13', 'HTTP', 'Basic & Digest auth (httpbin)', '200 cả hai (digest tự retry với nonce)', 'pass'),
    ('TC14', 'HTTP', 'gzip, redirect ×3, Set-Cookie, 503, ảnh PNG, delay 3s', 'Giải nén, theo redirect, lưu cookie, hiển thị ảnh, đo thời gian 3,00 s', 'pass'),
    ('TC15', 'HTTP', 'Gửi tới cổng không mở (connection refused)', 'Báo lỗi đúng, nhưng mất 2–4 s và thông báo còn thô (xem V1, S1)', 'remark'),
    ('TC16', 'GraphQL', 'Query + variables, Fetch schema (introspection)', '200, dữ liệu đúng; schema 7 type, cây query/mutation', 'pass'),
    ('TC17', 'cURL', 'Xuất code snippet cURL (bash) rồi chạy lệnh trong shell', 'Lệnh chạy được, kết quả giống trong app; có 13 ngôn ngữ', 'pass'),
    ('TC18', 'cURL', 'Dán lệnh cURL (-X PATCH, -H, --data-raw, -u) vào thanh URL', 'Method, header, body, Basic auth đều đúng (server echo xác nhận)', 'pass'),
    ('TC19', 'Runner', 'Chạy cả collection (27 request, 1 vòng)', '7/7 test qua; biểu đồ thời gian theo request; 2 request trống URL báo lỗi rõ ràng', 'pass'),
    # Protocols
    ('TC20', 'Giao thức', 'WebSocket: kết nối, nhận welcome, gửi JSON, nhận echo, ngắt', 'Đúng; log có thời gian. Handshake không gửi User-Agent (V2)', 'remark'),
    ('TC21', 'Giao thức', 'SSE: stream 5 event có id/event/data', 'Nhận đủ 5 event, “Stream ended”', 'pass'),
    ('TC22', 'Giao thức', 'MQTT: kết nối broker, subscribe, publish QoS 0, nhận lại', 'Đúng, có suback/pkid', 'pass'),
    ('TC23', 'Giao thức', 'gRPC: reflection, sinh template JSON, gọi unary Sum', '34 method; template {a,b}; kết quả v=42, status OK', 'pass'),
    # New: unsaved dialog
    ('TC24', 'Đóng tab (mới)', 'Ctrl+W trên tab có thay đổi', 'Hiện “Save changes?” giống Postman', 'pass', N),
    ('TC25', 'Đóng tab (mới)', 'Cancel', 'Hộp thoại đóng, tab và thay đổi giữ nguyên', 'pass', N),
    ('TC26', 'Đóng tab (mới)', 'Don\'t save rồi mở lại request', 'Tab đóng; request trong collection không đổi', 'pass', N),
    ('TC27', 'Đóng tab (mới)', 'Save changes với request mới chưa lưu', 'Mở “Save request”, lưu vào collection rồi đóng tab', 'pass', N),
    ('TC28', 'Đóng tab (mới)', 'Close all với 1 tab sạch + 2 tab có thay đổi', 'Tab sạch đóng ngay; hỏi lần lượt, có “1 more tab after this one”', 'pass', N),
    ('TC29', 'Đóng tab (mới)', 'Tick “Always discard…” và tắt lại trong Settings', 'Các tab còn lại đóng không hỏi; setting được lưu và bỏ được', 'pass', N),
    # New: variable popover
    ('TC30', 'Popover biến (mới)', 'Rê chuột lên {{baseUrl}}', 'Hiện giá trị + nguồn Environment (E)', 'pass', N),
    ('TC31', 'Popover biến (mới)', 'Sửa giá trị trong popover rồi Send', 'Request đi tới giá trị mới (18099); đặt lại thành công', 'pass', N),
    ('TC32', 'Popover biến (mới)', 'Biến chưa định nghĩa {{traceId}}', 'Viền đỏ ở URL và bảng; popover “Unresolved”, chọn scope, thêm được', 'pass', N),
    ('TC33', 'Popover biến (mới)', 'Biến động {{$guid}}', 'Hiện “Dynamic variable” + giá trị ví dụ', 'pass', N),
    # New: resize
    ('TC34', 'Kích thước (mới)', 'Kéo cột Key và Description trong bảng Params', 'Đổi độ rộng, được nhớ (localStorage), dùng chung giữa các bảng', 'pass', N),
    ('TC35', 'Kích thước (mới)', 'Kéo vạch chia Request/Response', 'Khung Response thấp hơn, tỉ lệ được nhớ', 'pass', N),
    # New: sidebar
    ('TC36', 'Cột trái (mới)', 'Ctrl+K, tìm “auth”', 'Focus ô tìm; tô sáng chỗ khớp; folder khớp hiện đủ request con', 'pass', N),
    ('TC37', 'Cột trái (mới)', 'Tìm chuỗi không có, rồi Esc', 'Thông báo “No requests or folders match”; Esc xoá', 'pass', N),
    ('TC38', 'Cột trái (mới)', 'Trạng thái mở folder sau tìm kiếm và sau tải lại', 'Lần đầu folder bị đóng hết (B1) → đã sửa, kiểm tra lại đạt', 'fixed', N),
    ('TC39', 'Cột trái (mới)', 'Nút + trên folder → Add HTTP request', 'Lần đầu folder tự đóng (B2) → đã sửa, kiểm tra lại đạt', 'fixed', N),
    ('TC40', 'Cột trái (mới)', 'Menu + đầu cột trái', 'New collection / 6 loại request / Import', 'pass', N),
    # Load testing
    ('TC41', 'Load test', 'Tạo kịch bản từ request (menu chuột phải)', 'Mở trình thiết kế, có sẵn check và threshold', 'pass'),
    ('TC42', 'Load test', 'Profile tuỳ chỉnh: 1→20 VU trong 10 s, giữ 30 s', 'Lần đầu form bị dịch khi sang Custom (B6) → đã sửa', 'fixed'),
    ('TC43', 'Load test', 'Chạy 40 s, dashboard trực tiếp', '428.683 request, ~10,7k rps, p95 3,0 ms, 0% lỗi, PASSED', 'pass'),
    ('TC44', 'Load test', 'Biểu đồ trong báo cáo cuối', 'Lần đầu biểu đồ Response time bị ép bởi threshold (B3) → đã sửa', 'fixed'),
    ('TC45', 'Load test', 'Nhãn percentile trên biểu đồ phân phối', 'Nhãn đè lên cột (B4) → thêm viền nền; vẫn sát nhau khi p95≈p99 (V6)', 'fixed'),
    ('TC46', 'Load test', 'Xuất báo cáo HTML + JUnit XML', 'File HTML 225 KB tự chứa, mở được, biểu đồ đúng; tiêu đề lặp chữ (B7) → đã sửa', 'fixed'),
    # General UI
    ('TC47', 'Giao diện chung', 'Mở 15 tab, tab mới nằm ngoài vùng nhìn', 'Tab đang mở bị cắt (B5) → đã sửa, tự cuộn vào', 'fixed'),
    ('TC48', 'Giao diện chung', 'Tải lại trang', 'Tab, bản nháp, độ rộng cột, tỉ lệ khung, folder mở đều được khôi phục', 'pass'),
    # Automated
    ('TC49', 'Tự động', 'vitest (Postman import, cURL, biến, sandbox)', '15/15 đạt', 'pass'),
    ('TC50', 'Tự động', 'cargo test (core + load engine integration), tsc, eslint', '11/11 đạt, tsc sạch, eslint 0 lỗi', 'pass'),
]

FIXED = [
    ('B1', 'med', 'Xoá ô tìm kiếm ở cột trái làm đóng hết folder đang mở.', 'Trạng thái mở/đóng nằm trong state cục bộ của từng dòng; khi tìm kiếm, dòng không khớp bị unmount nên mất state.', 'Đưa trạng thái mở/đóng vào store dùng chung, lưu localStorage (còn giữ sau khi khởi động lại).', 'src/stores/ui.ts, src/features/sidebar/CollectionsView.tsx'),
    ('B2', 'med', 'Chọn mục trong menu (+ hoặc …) của folder/request làm folder tự đóng/mở, hoặc mở luôn request.', 'React cho sự kiện click trong portal của menu nổi bọt lên dòng của cây (dòng có onClick toggle).', 'Chặn lan truyền click ở Dropdown và ContextMenu dùng chung; sửa luôn cho các menu “…” có sẵn.', 'src/components/ui.tsx'),
    ('B3', 'high', 'Biểu đồ Response time trong báo cáo cuối bị ép phẳng: threshold p95 < 1000 ms kéo trục lên 1 s, dữ liệu ~3 ms không đọc được (cả trong file HTML xuất ra).', 'Thang trục Y luôn tính cả giá trị của đường tham chiếu.', 'Chỉ đưa đường threshold vào thang khi ≤ 3× giá trị dữ liệu lớn nhất; ngoài khoảng đó thì hiện ghi chú “▲ … (above the chart)”.', 'src/components/charts.tsx'),
    ('B4', 'low', 'Nhãn p50/p95/p99 trên biểu đồ phân phối nằm đè lên cột, khó đọc.', 'Chữ không có nền.', 'Thêm viền nền (halo) theo màu surface và giãn dòng 13 px.', 'src/components/charts.tsx'),
    ('B5', 'med', 'Khi nhiều tab, tab vừa mở/đang chọn nằm ngoài vùng nhìn của thanh tab.', 'Thanh tab cuộn ngang nhưng không cuộn theo tab active.', 'Tự scrollIntoView khi tab active đổi hoặc số tab đổi.', 'src/app/App.tsx'),
    ('B6', 'low', 'Đổi preset sang Custom làm dòng mô tả biến mất, form dịch lên ~10 px (click nhầm ô).', 'Preset Custom không có mô tả nên dòng render rỗng.', 'Luôn hiện dòng mô tả (Custom có mô tả riêng).', 'src/features/load/ScenarioEditor.tsx'),
    ('B7', 'low', 'Tiêu đề trang báo cáo HTML bị lặp: “… – load test – load test report”.', 'Ghép chuỗi cố định với tên kịch bản đã có “load test”.', 'Chỉ thêm “load test” khi tên chưa có.', 'src/lib/load/report.ts'),
]

EVAL = [
    ('V1', 'bug', 'med', 'Kết nối bị từ chối tới localhost mất 2–4 giây mới báo lỗi', 'Trên Windows, “localhost” được thử ::1 rồi 127.0.0.1, mỗi lần có retry. Đề xuất: thêm connect timeout riêng (vd 3 s) và happy-eyeballs, hoặc ưu tiên IPv4 cho localhost; hiện trạng thái “Connecting…”.'),
    ('V2', 'bug', 'low', 'WebSocket handshake không gửi User-Agent', 'Server mock nhận ua = null. Postman gửi User-Agent mặc định; một số gateway chặn khi thiếu. Đề xuất gửi “CurlStudio/0.1” như HTTP.'),
    ('V3', 'bug', 'low', 'Hộp thoại Settings tự focus ô “Request timeout”', 'Do quy tắc autofocus “ô nhập đầu tiên”. Đề xuất không autofocus trong Settings, hoặc focus vào Theme.'),
    ('V4', 'bug', 'med', 'Import động plugin Tauri (dialog/opener) trong native.ts', 'Cùng nguyên nhân làm nút “Mở” của GitStudio không hoạt động: khi cache Vite bị xoá lúc dev server đang chạy, import động trả 504 và lỗi bị nuốt. Đề xuất import tĩnh và thêm handler unhandledrejection hiện toast (đã làm cho GitStudio).'),
    ('V5', 'bug', 'low', 'Biểu đồ Runner dùng thang tuyến tính', 'Một request chậm (3 s) làm các request khác (1–18 ms) thành vạch mỏng. Đề xuất thang log hoặc nút chuyển, và sắp xếp theo thời gian.'),
    ('V6', 'bug', 'low', 'Nhãn percentile vẫn sát nhau khi p95 ≈ p99', 'Đã thêm halo (B4) nhưng chưa tránh va chạm theo trục X. Đề xuất gom nhãn thành chú thích ở góc khi khoảng cách < 40 px.'),
    ('S1', 'idea', 'med', 'Thông báo lỗi mạng thân thiện hơn', 'Hiện nguyên chuỗi “error sending request … os error 10061”. Đề xuất: tiêu đề ngắn (Không kết nối được / DNS / TLS / Timeout), gợi ý xử lý, chi tiết gốc thu gọn.'),
    ('S2', 'idea', 'med', 'Giữ response cuối của mỗi tab sau khi tải lại/khởi động lại', 'Postman giữ response gần nhất. Hiện tại tab được khôi phục nhưng khung Response trống.'),
    ('S3', 'idea', 'med', 'Popover biến trong body raw và script (CodeMirror)', 'Popover hiện có ở mọi ô một dòng; body JSON và script chưa có hover/tô màu biến như Postman.'),
    ('S4', 'idea', 'low', 'Popover hiển thị cả Initial value và Current value', 'Postman hiện hai giá trị cho biến environment; và che giá trị kiểu secret (••••) có nút hiện.'),
    ('S5', 'idea', 'med', 'Gợi ý (autocomplete) và kiểm tra lỗi GraphQL theo schema đã tải', 'Schema đã tải được nhưng editor query chưa dùng để gợi ý field/kiểm tra lỗi.'),
    ('S6', 'idea', 'low', 'Quản lý nhiều tab', 'Với >8 tab, tên bị cắt còn ~8 ký tự. Đề xuất menu liệt kê tab (như nút ⌄ của Postman), “Close saved tabs”, ghim tab.'),
    ('S7', 'idea', 'med', 'Load test: tự chuyển script lấy token thành extractor', 'Load test không chạy script JS (giới hạn đã biết). Đề xuất nhận dạng mẫu pm.environment.set(\'x\', pm.response.json().y) để tạo extractor JSONPath tự động.'),
    ('S8', 'idea', 'low', 'Runner: đếm riêng phản hồi non-2xx và lọc request lỗi', '“Failed requests” chỉ đếm lỗi mạng (giống Postman); 422/503 không có test thì không bị đánh dấu.'),
    ('S9', 'idea', 'low', 'MQTT: subscription mặc định “#”', 'Trên broker dùng chung sẽ nhận toàn bộ topic. Đề xuất mặc định theo topic publish (vd test/#).'),
    ('S10', 'idea', 'low', 'Cột trái: “Reveal” request đang mở và điều hướng bằng bàn phím', 'Mở request từ tab không tự mở folder chứa nó; chưa có phím mũi tên/Enter trong cây.'),
]


# ---- round 2: what was done with each evaluated item -------------------------------------------
# (id, status, what was done, how it was verified)
RESOLVED = [
    ('V1', 'partial', 'localhost được phân giải IPv4 trước rồi IPv6 (happy-eyeballs chạy song song thay vì nối tiếp). Trong lúc chờ, khung Response hiện đồng hồ “Sending request… 2.4 s”.', 'Đo qua bridge: 2,56 s (trước đây 2–4 s). curl.exe và .NET trên cùng máy cũng mất 2,0 s, vì Windows tự gửi lại SYN khi bị RST. Phần ~2 s còn lại là hành vi của hệ điều hành.'),
    ('V2', 'done', 'Handshake WebSocket gửi User-Agent: CurlStudio/0.1.0 (trừ khi người dùng đã đặt header này).', 'Server echo nhận ua = "CurlStudio/0.1.0".'),
    ('V3', 'done', 'Settings mới không tự focus ô nào; mọi thay đổi được lưu ngay.', 'Mở bằng Ctrl+, không còn ô nào bị focus.'),
    ('V4', 'done', 'native.ts và ipc.ts import tĩnh @tauri-apps/plugin-dialog, plugin-opener và api/core. Toast lỗi cũng tự ghi vào Activity Logs.', 'tsc, build production và crate Tauri đều sạch.'),
    ('V5', 'done', 'Biểu đồ Runner có chọn thang Linear/Log (mặc định Log) và thứ tự Run order/Slowest first.', 'Chạy 27 request: ở thang log, các thanh 1–36 ms vẫn đọc được bên cạnh 3 s.'),
    ('V6', 'done', 'Nhãn percentile được xếp theo hàng có ước lượng độ rộng chữ (không bao giờ chồng nhau); nhãn sát mép phải lật sang trái, có viền nền.', 'Unit test placeLabels (2 ca).'),
    ('S1', 'done', 'Lỗi mạng được phân loại (refused / DNS / TLS / timeout / URL / reset / proxy), kèm tiêu đề ngắn, gợi ý xử lý và chi tiết gốc thu gọn.', 'UI: “Connection refused by localhost:18099” + gợi ý. Unit test explainError (2 ca).'),
    ('S2', 'done', 'Response cuối của mỗi tab được lưu (tối đa 1 MB mỗi body, 4 MB tổng) và khôi phục sau khi tải lại, kèm dòng “from <thời điểm>”.', 'Tải lại trang: response Login vẫn còn, có dòng “from 11/19/2026, 10:13:27 PM”.'),
    ('S3', 'done', 'Editor body/script/GraphQL/WS/MQTT/gRPC có popover biến khi rê chuột (sửa tại chỗ). Màu biến giờ hiện đúng cả bên trong chuỗi JSON, và cập nhật khi đổi environment.', 'UI: rê chuột lên {{password}} trong body JSON thì popover hiện ra.'),
    ('S4', 'done', 'Popover hiện Current value (sửa được) và Initial value (có nút “Use”); biến secret bị che, có nút mắt để hiện.', 'UI: {{password}} (secret) hiện dạng ••••••.'),
    ('S5', 'done', 'Sau khi tải schema: gợi ý field theo đúng type tại con trỏ (Ctrl+Space hoặc khi gõ), gạch chân đỏ field không tồn tại, sub-selection trên scalar và ngoặc thiếu; thanh trạng thái dưới editor. Schema được nhớ theo URL.', 'UI: field sai bị gạch chân, “2 problems…”; gõ “he” gợi ý hello. Unit test 3 ca.'),
    ('S6', 'done', 'Ghim tab (luôn đứng đầu, không có nút ×, bỏ qua khi Close others/all), “Close saved tabs”, nút ⌄ liệt kê mọi tab đang mở, tooltip tên đầy đủ.', 'UI: ghim Runner rồi Close saved tabs: tab ghim và 7 tab có thay đổi chưa lưu vẫn còn, không có hộp thoại.'),
    ('S7', 'done', 'Script test kiểu pm.environment/collectionVariables/globals/variables.set(…, json.a.b / headers.get / cookies.get / response.code) được chuyển thành extractor khi tạo load test, có toast thông báo.', 'UI: Login → extractor token = $.token; Debug Login → Me: 200 với token đã trích. Unit test 3 ca.'),
    ('S8', 'done', 'Runner có bộ đếm Non-2xx riêng và bộ lọc All / Failed / Non-2xx.', 'UI: Non-2xx = 3 (404, 422, 503), bộ lọc khớp với số đếm.'),
    ('S9', 'done', 'Subscription MQTT mặc định đổi từ “#” thành “test/#”.', 'Kiểm tra trong mã (makeItem).'),
    ('S10', 'done', 'Mở tab request thì cây tự mở folder và cuộn tới request đó; menu tab có “Reveal in sidebar”. Cây điều hướng được bằng ↑/↓/Home/End, ←/→ thu gọn/mở, Enter mở (role=tree).', 'UI: ↓↓ Enter mở “API key”; ← về “0. Auth”; ← thu gọn; → mở lại.'),
]

# Bugs found and fixed while doing the above (and the GitStudio features)
FIXED2 = [
    ('B8', 'low', 'Dòng “CurlStudio started” bị ghi 2 lần mỗi lần tải trang.', 'React StrictMode chạy effect hai lần ở chế độ dev.', 'Chặn bằng một cờ ở mức module.', 'src/app/App.tsx'),
    ('B9', 'low', 'Cửa sổ Activity Logs luôn báo kích thước file là 0 KB.', 'Số liệu chỉ được đọc lúc khởi động.', 'activity.append trả về số liệu mới sau mỗi lần ghi.', 'activity.rs, stores/activity.ts'),
    ('B10', 'med', 'Gõ nhanh hoặc dán vào terminal tích hợp bị mất/đảo ký tự.', 'Mỗi phím là một lệnh ghi riêng chạy song song.', 'Hàng đợi ghi tuần tự, gom các ký tự đang chờ thành một lần gửi.', 'features/terminal/runtime.ts'),
    ('B11', 'low', 'Biến {{x}} bên trong chuỗi JSON hiện màu chuỗi thay vì màu biến.', 'Span tô màu cú pháp nằm bên trong span biến.', 'Phần tử con kế thừa màu biến.', 'components/CodeEditor.tsx'),
    ('B12', 'high', 'Snippet “cURL (PowerShell)” có body JSON bị server báo “invalid JSON” (cả khi dán tay).', 'Windows PowerShell 5.1 làm rơi dấu " bên trong đối số truyền cho curl.exe.', 'Sinh `curl.exe --% …` (stop-parsing, trích dẫn kiểu cmd, một dòng). Chạy trong PowerShell 5.1 → 200.', 'src/lib/curl.ts'),
    ('B13', 'med', 'Ô path của extractor chỉ rộng 22 px; nhiều ô khác cũng sai độ rộng.', 'Input luôn có w-full, đè lên w-32/w-24 truyền vào.', 'Input chỉ thêm w-full khi không có class độ rộng.', 'components/ui.tsx'),
    ('B14', 'low', 'Run in terminal: body JSON nhiều dòng bị shell hiểu là Enter.', 'Có ký tự xuống dòng nằm trong chuỗi.', 'Với terminal, body JSON hợp lệ được rút gọn thành một dòng (cùng dữ liệu).', 'features/dialogs/Dialogs.tsx'),
    ('B15', 'low', 'Bộ lọc Non-2xx đếm cả request lỗi mạng (không có mã trạng thái).', 'Định nghĩa của bộ lọc và bộ đếm khác nhau.', 'Dùng chung một định nghĩa.', 'features/runner/RunnerTab.tsx'),
]

GITSTUDIO = [
    ('Thanh trạng thái', 'Environment (bấm để sửa), số load test đang chạy, Console, Terminal, Activity Logs (badge đỏ khi có lỗi trong 10 phút gần nhất), phím tắt, zoom −/%/+, Help, phiên bản.'),
    ('Activity Logs (Ctrl+Shift+L)', 'Ghi request (method, URL, status, test, thời gian), lần chạy Runner, load test (bắt đầu/kết thúc/verdict), terminal, toast lỗi và toast thành công. Nhóm All / Requests / Load & Runner / Application, lọc chữ, “Failures only”, lưu ra file .log, xoá. Lưu trong activity.jsonl (giữ 30 ngày, tối đa 10 MB).'),
    ('Keyboard Shortcuts (Ctrl+/)', 'Cửa sổ danh mục có ô lọc. Phím mới: Ctrl+/, Ctrl+Shift+L, Ctrl+= / Ctrl+- / Ctrl+0 (zoom), Ctrl+` (terminal), Ctrl+Alt+C (console; trước đây là Ctrl+`), Ctrl+\\ (ẩn/hiện sidebar), Ctrl+, (Settings), F1 (Help).'),
    ('Kích thước / zoom', 'Zoom 60–200% (thanh trạng thái, phím tắt, Settings), cỡ chữ editor, panel terminal kéo được độ cao, sidebar ẩn/hiện.'),
    ('Giao diện', 'Settings chia mục General / Appearance / Terminal / Data & Logs / About, lưu ngay khi đổi. Theme Dark/Light/System, độ sáng riêng cho từng theme (70–130%).'),
    ('Terminal tích hợp (Ctrl+`)', 'PTY thật (ConPTY trên Windows) với xterm: nhiều session, chọn shell (auto / Windows PowerShell / PowerShell 7 / cmd / Git Bash), thư mục khởi động, font lấy theo Windows Terminal. Nút “Run in terminal” trong Code snippet gõ sẵn lệnh cURL đúng cú pháp shell.'),
    ('Trợ giúp (F1)', 'Form Help & Support gửi email qua FormSubmit (như GitStudio), có validate và đính kèm phiên bản/OS; tab About hiện phiên bản app/core, hệ điều hành, thư mục workspace.'),
    ('Phiên bản', '__APP_VERSION__ lấy từ package.json, hiện trên thanh trạng thái, trong Help và Settings → About.'),
]


def data_uri(name: str) -> str:
    path = os.path.join(SHOTS, B + IMAGES[name])
    with open(path, 'rb') as f:
        mime = 'image/png' if path.endswith('.png') else 'image/jpeg'
        return f'data:{mime};base64,' + base64.b64encode(f.read()).decode()


def main() -> None:
    with open(os.path.join(HERE, 'template.html'), encoding='utf-8') as f:
        html = f.read()
    tc = [dict(id=t[0], area=t[1], what=t[2], result=t[3], status=t[4], isNew=len(t) > 5) for t in TC]
    fixed = [dict(id=b[0], sev=b[1], what=b[2], cause=b[3], fix=b[4], files=b[5]) for b in FIXED]
    ev = [dict(id=e[0], kind=e[1], sev=e[2], title=e[3], detail=e[4]) for e in EVAL]
    dump = lambda v: json.dumps(v, ensure_ascii=False).replace('</', '<\\/')
    html = html.replace('__TC__', dump(tc)).replace('__FIXED__', dump(fixed)).replace('__EVAL__', dump(ev))
    html = html.replace('__RESOLVED__', dump([dict(id=r[0], status=r[1], done=r[2], verify=r[3]) for r in RESOLVED]))
    html = html.replace('__FIXED2__', dump([dict(id=b[0], sev=b[1], what=b[2], cause=b[3], fix=b[4], files=b[5]) for b in FIXED2]))
    html = html.replace('__GITSTUDIO__', dump([dict(name=g[0], what=g[1]) for g in GITSTUDIO]))
    for name in IMAGES:
        html = html.replace(f'__IMG_{name}__', data_uri(name))
    missing = [m for m in ('__IMG_', '__TC__', '__FIXED__', '__EVAL__', '__RESOLVED__', '__FIXED2__', '__GITSTUDIO__') if m in html]
    if missing:
        raise SystemExit(f'unfilled placeholders: {missing}')
    out = os.path.join(HERE, 'CurlStudio-test-report.html')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print(out, f'{len(html) // 1024} KB', f'{len(tc)} TCs, {len(fixed)} fixed, {len(ev)} eval items')


if __name__ == '__main__':
    main()
