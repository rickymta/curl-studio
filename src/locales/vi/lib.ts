// Vietnamese strings for the "lib" area. Keys are the exact English source strings passed to t().
export const lib: Record<string, string> = {
  // ---- netError.ts (failed request explanation in the response panel)
  'Connection refused by {target}': '{target} từ chối kết nối',
  'Connection refused by the server': 'Server từ chối kết nối',
  'Nothing is listening on that address. Is the server running, and are the host, port and variables such as {{baseUrl}} right?':
    'Không có gì đang lắng nghe ở địa chỉ đó. Server đã chạy chưa, host, port và các biến như {{baseUrl}} có đúng không?',
  'Host not found ({target})': 'Không tìm thấy host ({target})',
  'Host not found': 'Không tìm thấy host',
  'The name could not be resolved. Check the spelling, your network or VPN, and the proxy setting.':
    'Không phân giải được tên miền. Hãy kiểm tra chính tả, mạng hoặc VPN của bạn và cài đặt proxy.',
  'TLS/SSL error': 'Lỗi TLS/SSL',
  'The certificate was not accepted. For a self-signed or local certificate, turn off “SSL certificate verification” in the request Settings tab (or in Settings → General).':
    'Chứng chỉ không được chấp nhận. Với chứng chỉ tự ký hoặc chứng chỉ nội bộ, hãy tắt “Xác minh chứng chỉ SSL” trong tab Cài đặt của request (hoặc trong Cài đặt → Chung).',
  'Request timed out ({target})': 'Request hết thời gian chờ ({target})',
  'Request timed out': 'Request hết thời gian chờ',
  'The server did not answer in time. Raise the timeout in the request Settings tab or in Settings → General, or check the network.':
    'Server không phản hồi kịp. Hãy tăng timeout trong tab Cài đặt của request hoặc trong Cài đặt → Chung, hoặc kiểm tra mạng.',
  'Invalid URL': 'URL không hợp lệ',
  'Check the URL. A red {{variable}} means it has no value in the active environment.':
    'Hãy kiểm tra URL. Một {{variable}} màu đỏ nghĩa là biến đó chưa có giá trị trong môi trường đang dùng.',
  'Connection closed by {target}': '{target} đã đóng kết nối',
  'Connection closed by the server': 'Server đã đóng kết nối',
  'The server dropped the connection. Try HTTP/1.1 (request Settings), or check the server logs.':
    'Server đã ngắt kết nối. Hãy thử HTTP/1.1 (Settings của request) hoặc kiểm tra log của server.',
  'Proxy error': 'Lỗi proxy',
  'Check the proxy in Settings → General (empty = system proxy, none = direct).':
    'Hãy kiểm tra proxy trong Cài đặt → Chung (để trống = proxy hệ thống, none = kết nối trực tiếp).',
  'Could not send request': 'Không gửi được request',
  'See the details below.': 'Xem chi tiết bên dưới.',

  // ---- ipc.ts
  'Backend unreachable ({error}). Run `pnpm bridge` or the desktop app.':
    'Không kết nối được backend ({error}). Hãy chạy `pnpm bridge` hoặc mở ứng dụng desktop.',

  // ---- native.ts (browser dev-mode prompts)
  '{title} (absolute path)': '{title} (đường dẫn tuyệt đối)',
  '{title} (absolute paths, separated by ;)': '{title} (đường dẫn tuyệt đối, cách nhau bằng dấu ;)',
  'Save to (absolute path)': 'Lưu vào (đường dẫn tuyệt đối)',

  // ---- format.ts (relative time)
  'just now': 'vừa xong',
  '{n}m ago': '{n} phút trước',
  '{n}h ago': '{n} giờ trước',

  // ---- build.ts (request warnings)
  'GraphQL variables are not valid JSON; sent as null': 'GraphQL variables không phải JSON hợp lệ; đã gửi null',
  'Basic auth uses per-VU variables; they are encoded with the values at start time':
    'Basic auth dùng biến theo từng VU; chúng được mã hoá bằng giá trị tại thời điểm bắt đầu',
  'OAuth 2.0: no access token yet (use "Get New Access Token")': 'OAuth 2.0: chưa có access token (hãy dùng "Lấy Access Token mới")',
  'JWT Bearer generation is not supported; set a Bearer token instead':
    'Chưa hỗ trợ tạo JWT Bearer; hãy đặt Bearer token thay thế',
  'Auth type "{type}" is not supported and was ignored': 'Kiểu auth "{type}" chưa được hỗ trợ và đã bị bỏ qua',
  'Unresolved variables: {names}': 'Biến chưa có giá trị: {names}',

  // ---- postman.ts (import errors)
  'Not a JSON object': 'Không phải một đối tượng JSON',
  'Unrecognised file: expected a Postman collection, environment or data dump':
    'Không nhận dạng được file: cần một Postman collection, môi trường hoặc data dump',

  // ---- curl.ts (import errors)
  'Not a curl command': 'Không phải lệnh curl',
  'No URL found in the curl command': 'Không tìm thấy URL trong lệnh curl',

  // ---- graphqlAssist.ts (inline query problems)
  'Field “{field}” does not exist on type {type}.': 'Field “{field}” không tồn tại trên kiểu {type}.',
  '{field} is a {type} and has no sub-fields.': '{field} có kiểu {type} và không có field con.',
  'Unexpected “}”.': 'Dấu “}” không mong đợi.',
  'This “{” is never closed.': 'Dấu “{” này chưa được đóng.',
};
