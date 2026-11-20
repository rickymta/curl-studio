// Vietnamese strings for the "app" area. Keys are the exact English source strings passed to t().
export const app: Record<string, string> = {
  // ---- App: tab strip
  'Run: {name}': 'Chạy: {name}',
  'Load test': 'Load test',
  'Report {id}': 'Báo cáo {id}',
  'Compare {n} runs': 'So sánh {n} lần chạy',
  'Load test runs': 'Các lần chạy load test',
  'Open tabs': 'Các tab đang mở',
  'Unpin tab': 'Bỏ ghim tab',
  'Pin tab': 'Ghim tab',
  'Reveal in sidebar': 'Hiện trong thanh bên',
  'Close others': 'Đóng các tab khác',
  'Close saved tabs': 'Đóng các tab đã lưu',
  'Close all': 'Đóng tất cả',
  'Close all tabs': 'Đóng tất cả tab',
  'Duplicate tab': 'Nhân bản tab',
  '{name} Copy': '{name} (bản sao)',
  '{title} — unsaved changes': '{title} — có thay đổi chưa lưu',
  Pinned: 'Đã ghim',
  'Close tab': 'Đóng tab',
  'New tab': 'Tab mới',
  'All open tabs ({n})': 'Tất cả tab đang mở ({n})',
  'All open tabs': 'Tất cả tab đang mở',

  // ---- App: new-item menus (protocol names stay as they are)
  'HTTP Request': 'HTTP Request',
  GraphQL: 'GraphQL',
  WebSocket: 'WebSocket',
  'Server-Sent Events': 'Server-Sent Events',
  gRPC: 'gRPC',
  MQTT: 'MQTT',
  'New {kind}': '{kind} mới',
  'New collection': 'Collection mới',
  'My Collection': 'Collection của tôi',
  'New environment': 'Môi trường mới',
  'Import environment…': 'Nhập môi trường…',
  'New load test': 'Load test mới',
  'New…': 'Tạo mới…',

  // ---- App: empty state
  'Ctrl+T new request · Ctrl+Enter send · Ctrl+S save · Ctrl+W close tab · Ctrl+` terminal · Ctrl+/ all shortcuts':
    'Ctrl+T request mới · Ctrl+Enter gửi · Ctrl+S lưu · Ctrl+W đóng tab · Ctrl+` terminal · Ctrl+/ tất cả phím tắt',

  // ---- App: sidebar
  'Load tests': 'Load test',
  Load: 'Load test',
  'Search collections (Ctrl+K)': 'Tìm collection (Ctrl+K)',
  'Search environments (Ctrl+K)': 'Tìm môi trường (Ctrl+K)',
  'Search history (Ctrl+K)': 'Tìm trong lịch sử (Ctrl+K)',
  'Search load tests (Ctrl+K)': 'Tìm load test (Ctrl+K)',
  'Show sidebar (Ctrl+\\)': 'Hiện thanh bên (Ctrl+\\)',
  'Hide sidebar (Ctrl+\\)': 'Ẩn thanh bên (Ctrl+\\)',
  'Search sidebar': 'Tìm trong thanh bên',
  'Clear search': 'Xoá nội dung tìm kiếm',

  // ---- App: title bar
  'Active environment': 'Môi trường đang dùng',
  'Edit environment': 'Sửa môi trường',
  'Console (Ctrl+Alt+C)': 'Console (Ctrl+Alt+C)',
  'Settings (Ctrl+,)': 'Cài đặt (Ctrl+,)',
  'Switch to light theme': 'Chuyển sang giao diện sáng',
  'Switch to dark theme': 'Chuyển sang giao diện tối',

  // ---- App: notifications
  'Could not reload the workspace': 'Không thể tải lại workspace',
  'Workspace reloaded from disk': 'Đã tải lại workspace từ ổ đĩa',
  'Activity Logs file is {size} MB': 'File Activity Logs đã nặng {size} MB',
  'It reached its maximum size: the oldest entries are being dropped.':
    'File đã đạt kích thước tối đa: các mục cũ nhất đang bị loại bỏ.',
  'Lower the retention period or clear it in Settings → Data & Logs.':
    'Hãy giảm thời gian lưu giữ hoặc xoá log trong Cài đặt → Dữ liệu & Log.',
  'Open settings': 'Mở cài đặt',

  // ---- Sidebar: collections
  'HTTP request': 'HTTP request',
  'GraphQL request': 'GraphQL request',
  'Add {kind}': 'Thêm {kind}',
  'Add folder': 'Thêm thư mục',
  'Add request or folder': 'Thêm request hoặc thư mục',
  'Run folder': 'Chạy thư mục',
  'Load test folder': 'Load test thư mục',
  'Edit folder': 'Sửa thư mục',
  'Copy as cURL': 'Sao chép dạng cURL',
  'Load test this request': 'Load test request này',
  'Run collection': 'Chạy collection',
  'Load test collection': 'Load test collection',
  'Edit (auth, scripts, variables)': 'Sửa (auth, script, biến)',
  'Collection v2.1 (recommended)': 'Collection v2.1 (khuyên dùng)',
  'Collection v2.0': 'Collection v2.0',
  'Rename collection': 'Đổi tên collection',
  'Delete collection': 'Xoá collection',
  'Delete "{name}" and all its requests?': 'Xoá "{name}" cùng toàn bộ request bên trong?',
  'Empty.': 'Trống.',
  'Add a request': 'Thêm request',
  'No collections yet': 'Chưa có collection nào',
  'Create one, or import a Postman collection (v2.0 / v2.1), environment, data dump or a cURL command.':
    'Hãy tạo mới, hoặc nhập collection Postman (v2.0 / v2.1), môi trường, bản data dump hay một lệnh cURL.',
  'No requests or folders match “{filter}”.': 'Không có request hay thư mục nào khớp “{filter}”.',

  // ---- Sidebar: environments
  'No environments': 'Chưa có môi trường nào',
  'Environments hold variables like': 'Môi trường chứa các biến như',
  'Import a Postman environment or create one.': 'Hãy nhập một môi trường Postman hoặc tạo mới.',
  Deactivate: 'Ngừng dùng',
  'Set active': 'Dùng môi trường này',
  'Rename environment': 'Đổi tên môi trường',
  'Export (Postman)': 'Xuất (Postman)',
  'Delete environment': 'Xoá môi trường',
  'Delete "{name}"?': 'Xoá "{name}"?',

  // ---- Sidebar: history
  'No history yet': 'Chưa có lịch sử',
  'Requests you send appear here.': 'Các request bạn gửi sẽ xuất hiện ở đây.',
  'Clear history': 'Xoá lịch sử',
  'Remove every history entry?': 'Xoá toàn bộ lịch sử?',
  'Clear all': 'Xoá tất cả',
  Today: 'Hôm nay',

  // ---- Sidebar: load tests
  Scenarios: 'Kịch bản',
  'New scenario': 'Kịch bản mới',
  'Right-click a collection, folder or request →': 'Nhấp chuột phải vào collection, thư mục hoặc request →',
  ', or create an empty scenario.': ', hoặc tạo một kịch bản trống.',
  'Delete scenario': 'Xoá kịch bản',
  'Delete "{name}"? Its past runs are kept.': 'Xoá "{name}"? Các lần chạy trước đó vẫn được giữ lại.',
  Runs: 'Lần chạy',
  'Compare {n}': 'So sánh {n}',
  'No runs yet.': 'Chưa có lần chạy nào.',
  'Open report': 'Mở báo cáo',
  'Delete run': 'Xoá lần chạy',
  'Delete run {id}?': 'Xoá lần chạy {id}?',
  'Select to compare': 'Chọn để so sánh',

  // ---- Dialogs: import
  'Imported {list}': 'Đã nhập {list}',
  'Postman collections (v1, v2.0, v2.1), environments, globals, full data dumps, or a cURL command.':
    'Collection Postman (v1, v2.0, v2.1), môi trường, globals, bản data dump đầy đủ, hoặc một lệnh cURL.',
  'Drop files here or': 'Thả file vào đây hoặc',
  'Choose files…': 'Chọn file…',
  '…or paste raw text (JSON or cURL)': '…hoặc dán văn bản thô (JSON hoặc cURL)',

  // ---- Dialogs: code snippet
  'Code snippet': 'Đoạn code',
  'Resolve variables': 'Thay giá trị biến',
  'Type the cURL command into the in-app terminal (press Enter there to run it)':
    'Gõ lệnh cURL vào terminal trong ứng dụng (nhấn Enter ở đó để chạy)',
  'Run in terminal': 'Chạy trong terminal',
  'Copied to clipboard': 'Đã sao chép vào clipboard',

  // ---- Dialogs: cookies
  'The workspace cookie jar: cookies set by responses are sent automatically on later requests.':
    'Kho cookie của workspace: cookie do response thiết lập sẽ tự động được gửi kèm các request sau.',
  'No cookies yet.': 'Chưa có cookie nào.',
  'Clear domain': 'Xoá cookie của domain',
  Session: 'Phiên',
  'Delete cookie': 'Xoá cookie',
  Domain: 'Domain',

  // ---- Dialogs: save request
  Saved: 'Đã lưu',
  'Save request': 'Lưu request',
  'Request name': 'Tên request',
  'Create “My Collection”': 'Tạo “Collection của tôi”',
  '(collection root)': '(gốc collection)',

  // ---- Dialogs: unsaved changes
  'Save changes?': 'Lưu thay đổi?',
  'has unsaved changes. Save these changes to avoid losing your work.':
    'có thay đổi chưa lưu. Hãy lưu lại để không mất công sức của bạn.',
  '({n} more tab after this one.)': '(Còn {n} tab nữa sau tab này.)',
  '({n} more tabs after this one.)': '(Còn {n} tab nữa sau tab này.)',
  'Always discard unsaved changes when closing a tab': 'Luôn bỏ thay đổi chưa lưu khi đóng tab',
  'You can turn this back off in Settings': 'Bạn có thể tắt lại tuỳ chọn này trong Cài đặt',
  "Don't save": 'Không lưu',
  'Save changes': 'Lưu thay đổi',

  // ---- Actions: default names, prompts
  'New Request': 'Request mới',
  'Untitled Request': 'Request chưa đặt tên',
  'New folder': 'Thư mục mới',
  'Folder name': 'Tên thư mục',
  'New Folder': 'Thư mục mới',
  'Delete "{name}"? This cannot be undone.': 'Xoá "{name}"? Không thể hoàn tác.',

  // ---- Actions: import / export
  'cURL request': 'request cURL',
  'Collection "{name}"': 'collection "{name}"',
  'Environment "{name}"': 'môi trường "{name}"',
  '{n} global variables': '{n} biến global',
  '{collections} collections, {environments} environments':
    '{collections} collection, {environments} môi trường',
  'Import Postman collections / environments': 'Nhập collection / môi trường Postman',
  'Postman export': 'File xuất từ Postman',
  'Exported "{name}" (Postman v{version})': 'Đã xuất "{name}" (Postman v{version})',
  'Exported "{name}"': 'Đã xuất "{name}"',
  'Workspace exported': 'Đã xuất workspace',
  'cURL copied to clipboard': 'Đã sao chép cURL vào clipboard',
};
