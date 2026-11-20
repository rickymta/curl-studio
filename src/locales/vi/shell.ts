// Vietnamese strings for the "shell" area. Keys are the exact English source strings passed to t().
export const shell: Record<string, string> = {
  // ---- Status bar (StatusBar.tsx)
  'Environment: {name} (click to edit)': 'Môi trường: {name} (bấm để sửa)',
  'No environment selected': 'Chưa chọn môi trường',
  'No environment': 'Không dùng môi trường',
  'Load tests running': 'Load test đang chạy',
  '{n} running': '{n} đang chạy',
  'Console (Ctrl+Alt+C)': 'Console (Ctrl+Alt+C)',
  'Terminal (Ctrl+`)': 'Terminal (Ctrl+`)',
  'Activity Logs (Ctrl+Shift+L)': 'Nhật ký hoạt động (Ctrl+Shift+L)',
  'Keyboard Shortcuts (Ctrl+/)': 'Phím tắt (Ctrl+/)',
  'Zoom out (Ctrl+-)': 'Thu nhỏ (Ctrl+-)',
  'Reset zoom (Ctrl+0)': 'Đặt lại thu phóng (Ctrl+0)',
  'Zoom in (Ctrl++)': 'Phóng to (Ctrl++)',
  'Help & Support (F1)': 'Trợ giúp & hỗ trợ (F1)',
  'About CurlStudio': 'Giới thiệu CurlStudio',

  // ---- Help & Support (HelpDialog.tsx, support.ts)
  'Help & Support': 'Trợ giúp & hỗ trợ',
  'Report a problem, suggest a feature or ask a question. We reply by email.':
    'Báo lỗi, đề xuất tính năng hoặc đặt câu hỏi. Chúng tôi sẽ trả lời qua email.',
  'Contact support': 'Liên hệ hỗ trợ',
  About: 'Giới thiệu',
  Email: 'Email',
  'What do you need help with?': 'Bạn cần hỗ trợ về vấn đề gì?',
  'Choose a topic': 'Chọn chủ đề',
  'Bug report': 'Báo lỗi',
  'Feature request': 'Đề xuất tính năng',
  Question: 'Câu hỏi',
  Other: 'Khác',
  Subject: 'Tiêu đề',
  Message: 'Nội dung',
  'Describe the problem or idea. For a bug, list the steps to reproduce it.':
    'Mô tả vấn đề hoặc ý tưởng. Nếu là lỗi, hãy ghi các bước để tái hiện.',
  'Attach app version and operating system': 'Đính kèm phiên bản ứng dụng và hệ điều hành',
  'This field is required.': 'Trường này là bắt buộc.',
  'Enter a valid email address.': 'Nhập địa chỉ email hợp lệ.',
  'Choose a topic.': 'Hãy chọn chủ đề.',
  'Too long.': 'Quá dài.',
  Submit: 'Gửi',
  'Could not send your message.': 'Không gửi được tin nhắn.',
  'Message sent': 'Đã gửi tin nhắn',
  'Thanks! We will reply to {email}.': 'Cảm ơn bạn! Chúng tôi sẽ trả lời tới {email}.',
  'Send another': 'Gửi tin khác',

  // ---- About (HelpDialog.tsx)
  'API client and load-testing studio · Postman, JMeter and k6 ideas in one app':
    'API client và công cụ load test · ý tưởng của Postman, JMeter và k6 trong một ứng dụng',
  'App version': 'Phiên bản ứng dụng',
  'Core version': 'Phiên bản core',
  System: 'Hệ thống',
  'Workspace folder': 'Thư mục workspace',
  'Keyboard shortcuts': 'Phím tắt',
  'Activity logs': 'Nhật ký hoạt động',

  // ---- Keyboard Shortcuts window (Windows.tsx, shortcuts.ts)
  'Keyboard Shortcuts': 'Phím tắt',
  'Filter shortcuts': 'Lọc phím tắt',
  'No shortcut matches “{q}”.': 'Không có phím tắt nào khớp “{q}”.',
  'Tabs and Navigation': 'Tab và điều hướng',
  'Panels and Windows': 'Bảng và cửa sổ',
  View: 'Hiển thị',
  'Send request': 'Gửi request',
  'Save request': 'Lưu request',
  'New HTTP request tab': 'Tab request HTTP mới',
  'Import (Postman, cURL)': 'Nhập (Postman, cURL)',
  'Import a cURL command': 'Nhập một lệnh cURL',
  'Variable card: save / cancel': 'Thẻ biến: lưu / huỷ',
  'Close tab': 'Đóng tab',
  'Next tab': 'Tab kế tiếp',
  'Previous tab': 'Tab trước',
  'Search the sidebar': 'Tìm trong thanh bên',
  'Show / hide the sidebar': 'Hiện / ẩn thanh bên',
  'Find in editor / response': 'Tìm trong trình soạn thảo / response',
  'Reload the workspace from disk': 'Tải lại workspace từ ổ đĩa',
  'Close dialog or menu': 'Đóng hộp thoại hoặc menu',
  'Toggle in-app terminal': 'Bật / tắt terminal trong ứng dụng',
  'Toggle console': 'Bật / tắt console',
  'Activity Logs': 'Nhật ký hoạt động',
  'Zoom in': 'Phóng to',
  'Zoom out': 'Thu nhỏ',
  'Reset zoom': 'Đặt lại thu phóng',
  'Copy selection': 'Sao chép vùng chọn',
  'Interrupt the running command': 'Ngắt lệnh đang chạy',
  'Enter (in the URL bar)': 'Enter (trong thanh URL)',
  'V (in the URL bar)': 'V (trong thanh URL)',
  'Middle click': 'Bấm chuột giữa',
  'C (with a selection)': 'C (khi có vùng chọn)',

  // ---- Activity Logs window (Windows.tsx)
  'Load tests & runner': 'Load test & runner',
  Application: 'Ứng dụng',
  'Filter logs': 'Lọc nhật ký',
  'Save as text file': 'Lưu thành tệp văn bản',
  'Clear log': 'Xoá nhật ký',
  'Clear Activity Logs': 'Xoá nhật ký hoạt động',
  'Delete every entry of the Activity Logs (also from activity.jsonl)? This cannot be undone.':
    'Xoá toàn bộ nhật ký hoạt động (cả trong activity.jsonl)? Không thể hoàn tác.',
  'Failures only': 'Chỉ mục thất bại',
  'No entries match.': 'Không có mục nào khớp.',
  'Nothing logged yet.': 'Chưa có gì được ghi lại.',
  ': started': ': đã bắt đầu',
  '{shown} of {total} entries': '{shown} trên {total} mục',
  '· saved to activity.jsonl ({used} KB of {max} MB, kept {days} days)':
    '· lưu vào activity.jsonl ({used} KB trên {max} MB, giữ {days} ngày)',
  '· saved to activity.jsonl ({used} KB of {max} MB, kept forever)':
    '· lưu vào activity.jsonl ({used} KB trên {max} MB, giữ vĩnh viễn)',

  // ---- Settings: sections (SettingsDialog.tsx)
  General: 'Chung',
  Appearance: 'Giao diện',
  'Data & Logs': 'Dữ liệu & nhật ký',
  'Changes are saved automatically.': 'Thay đổi được lưu tự động.',

  // ---- Settings: General
  'Request timeout': 'Timeout của request',
  'Milliseconds; a request can override it in its Settings tab.':
    'Tính bằng mili giây; mỗi request có thể đặt riêng trong tab Cài đặt của nó.',
  Redirects: 'Redirect',
  'Follow redirects': 'Tự động theo redirect',
  max: 'tối đa',
  Proxy: 'Proxy',
  'Empty = system proxy · none = direct · http://host:port · socks5://…':
    'Để trống = proxy hệ thống · none = kết nối trực tiếp · http://host:port · socks5://…',
  'system proxy': 'proxy hệ thống',
  Connection: 'Kết nối',
  'SSL certificate verification': 'Xác minh chứng chỉ SSL',
  'Use the cookie jar': 'Dùng cookie jar',
  'Force HTTP/1.1': 'Buộc dùng HTTP/1.1',
  'Largest response shown': 'Response lớn nhất được hiển thị',
  'Megabytes. Bigger bodies can still be saved to a file.':
    'Tính bằng megabyte. Body lớn hơn vẫn có thể lưu ra tệp.',
  'History entries kept': 'Số mục lịch sử được giữ',
  'Closing tabs': 'Đóng tab',
  'When off, tabs with unsaved changes ask “Save changes?”.':
    'Khi tắt, tab có thay đổi chưa lưu sẽ hỏi “Lưu thay đổi?”.',
  'Always discard unsaved changes when closing a tab': 'Luôn bỏ thay đổi chưa lưu khi đóng tab',

  // ---- Settings: Appearance
  Brightness: 'Độ sáng',
  Language: 'Ngôn ngữ',
  Theme: 'Chủ đề',
  "System follows the operating system's light/dark setting.":
    'Hệ thống: theo cài đặt sáng/tối của hệ điều hành.',
  Dark: 'Tối',
  Light: 'Sáng',
  'Brightness — dark theme': 'Độ sáng — giao diện tối',
  'Dims or brightens the whole window while the dark theme is on.':
    'Làm tối hoặc sáng toàn bộ cửa sổ khi dùng giao diện tối.',
  'Brightness — light theme': 'Độ sáng — giao diện sáng',
  'Each theme keeps its own value.': 'Mỗi giao diện giữ mức riêng.',
  Zoom: 'Thu phóng',
  'Ctrl + / Ctrl − / Ctrl 0 anywhere, or the status bar.':
    'Ctrl + / Ctrl − / Ctrl 0 ở bất kỳ đâu, hoặc dùng thanh trạng thái.',
  'Editor font size': 'Cỡ chữ trình soạn thảo',
  'Body, script and response editors (pixels).':
    'Trình soạn thảo body, script và response (pixel).',

  // ---- Settings: Terminal
  default: 'mặc định',
  Shell: 'Shell',
  'Used for new sessions of the in-app terminal (Ctrl+`).':
    'Dùng cho các phiên mới của terminal trong ứng dụng (Ctrl+`).',
  'Automatic (PowerShell on Windows, $SHELL elsewhere)':
    'Tự động (PowerShell trên Windows, $SHELL trên hệ khác)',
  'Start in folder': 'Thư mục khởi đầu',
  'Empty = your home folder.': 'Để trống = thư mục home của bạn.',
  'home folder': 'thư mục home',
  'Folder new terminals start in': 'Thư mục khởi đầu của terminal mới',
  Font: 'Phông chữ',
  'Taken from your Windows Terminal profile when there is one, so prompt icons render.':
    'Lấy từ profile Windows Terminal của bạn nếu có, để các icon trên prompt hiển thị đúng.',

  // ---- Settings: Data & Logs
  'Collections (Postman v2.1 files), environments, load runs, settings.':
    'Collection (tệp Postman v2.1), môi trường, các lần chạy load test, cài đặt.',
  Backup: 'Sao lưu',
  'Every collection, environment and globals in one Postman data dump.':
    'Mọi collection, môi trường và globals trong một bản data dump của Postman.',
  'Export all (Postman dump)': 'Xuất tất cả (Postman dump)',
  'Requests, load tests and app events are appended to activity.jsonl in the workspace folder and read back at startup.':
    'Request, load test và sự kiện của ứng dụng được ghi thêm vào activity.jsonl trong thư mục workspace và đọc lại khi khởi động.',
  '{used} of {max}': '{used} trên {max}',
  '{n} entries loaded': 'đã tải {n} mục',
  'Activity Logs file size': 'Dung lượng tệp nhật ký hoạt động',
  'At the size limit: the oldest entries are being dropped':
    'Đã chạm giới hạn: các mục cũ nhất đang bị xoá',
  'Over the warning size': 'Vượt ngưỡng cảnh báo',
  'Delete logs after (days)': 'Tự xoá nhật ký sau (ngày)',
  'Older entries are removed when CurlStudio starts. 0 keeps everything.':
    'Các mục cũ hơn sẽ bị xoá khi CurlStudio khởi động. Đặt 0 để giữ tất cả.',
  'Warn when larger than (MB)': 'Cảnh báo khi lớn hơn (MB)',
  'Maximum size (MB)': 'Dung lượng tối đa (MB)',
  'Past this size the oldest entries are dropped automatically.':
    'Vượt quá dung lượng này, các mục cũ nhất sẽ tự động bị xoá.',
  'Entries loaded at startup': 'Số mục tải khi khởi động',
  'Only the most recent entries are loaded, so startup stays fast.':
    'Chỉ tải các mục gần nhất để khởi động vẫn nhanh.',
  'Request history': 'Lịch sử request',
  '{n} entries': '{n} mục',

  // ---- Terminal panel (TerminalPanel.tsx, runtime.ts)
  'Close terminal': 'Đóng terminal',
  'New terminal': 'Terminal mới',
  'Hide terminal (Ctrl+`)': 'Ẩn terminal (Ctrl+`)',
  'Kill all terminals': 'Tắt tất cả terminal',
  'Close terminal panel': 'Đóng bảng terminal',
  'Drag to resize, double-click to reset': 'Kéo để đổi kích thước, bấm đúp để đặt lại',
  'Could not start the terminal: {error}': 'Không khởi động được terminal: {error}',
  '[Process exited]': '[Tiến trình đã thoát]',

  // ---- Split (Split.tsx)
  'Resize panes': 'Đổi kích thước các khung',
  'Drag to resize · double-click to reset': 'Kéo để đổi kích thước · bấm đúp để đặt lại',

  // ---- Key-value table (KeyValueTable.tsx)
  'Resize column': 'Đổi độ rộng cột',
  'key:value — one per line, prefix with // to disable':
    'key:value — mỗi dòng một cặp, thêm // ở đầu để tắt',
  'Key-Value Edit': 'Sửa dạng Key-Value',
  'Bulk edit': 'Sửa hàng loạt',
  Bulk: 'Bulk',
  Text: 'Văn bản',
  File: 'Tệp',
  'No file': 'Chưa có tệp',
  'Select files': 'Chọn tệp',

  // ---- Variable card (VarPopover.tsx, varTooltip.ts)
  'Variable {name}': 'Biến {name}',
  'Dynamic variable': 'Biến động',
  'A new value is generated for each request, e.g. {example}':
    'Mỗi request sẽ sinh một giá trị mới, ví dụ {example}',
  'Not a known dynamic variable.': 'Không phải biến động đã biết.',
  'Current value': 'Giá trị hiện tại',
  'Enter value': 'Nhập giá trị',
  'Hide value': 'Ẩn giá trị',
  'Show value': 'Hiện giá trị',
  'Initial value': 'Giá trị ban đầu',
  'Initial value: {value}': 'Giá trị ban đầu: {value}',
  '(empty)': '(trống)',
  Use: 'Dùng',
  'Unresolved variable — type a value to add it to:':
    'Biến chưa có giá trị — nhập giá trị để thêm vào:',
  'Scope for the new variable': 'Phạm vi của biến mới',
  'Open {scope}': 'Mở {scope}',

  // ---- Charts (charts.tsx; on screen only, exported reports stay English)
  '(above the chart)': '(nằm ngoài biểu đồ)',
  'No data': 'Không có dữ liệu',
  '{n} requests': '{n} request',
  fewer: 'ít hơn',
  'more requests': 'nhiều request hơn',
};
