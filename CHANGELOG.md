# Changelog

Các thay đổi đáng chú ý của CurlStudio. File này do `pnpm release` cập nhật.

## v0.2.1 - 2026-11-20

Thay đổi từ v0.2.0.

- feat(ui): app-styled prompts, context menu, checkboxes and radios (e4662bd)

## v0.2.0 - 2026-11-20

Thay đổi từ v0.1.1.

- feat(i18n): Vietnamese interface (aadebd7)
- feat(i18n): language infrastructure, first-run picker and Appearance setting (ed577ae)
- style: rustfmt and clippy (collapsible_if) for the new shell code (d88e37e)
- docs: README for the new shell features (512e764)
- feat(window): single instance and a start size that fits the screen (8119f6f)
- feat(shell): F5 / Ctrl+R reload the workspace, theme toggle in the title bar (4a74869)
- feat(activity): configurable log limits, size warnings and confirm before clearing (16ab220)
- fix(shell): disable the webview's F1-F12 default actions in the desktop app (f5a5089)
- feat(shell): GitStudio-style notifications and global error toasts (5874ea0)

## v0.1.1 - 2026-11-20

Thay đổi từ v0.1.0.

- fix(vars): green for variables with a value, red for missing or empty ones (5a88336)

## v0.1.0 - 2026-11-19

Phát hành đầu tiên: API client theo tinh thần Postman cộng với studio load test (ý tưởng từ Postman, JMeter và k6).

**Giao thức**

- HTTP (mọi method, form-data, urlencoded, raw, binary), GraphQL (schema introspection, gợi ý field, kiểm tra lỗi theo schema), WebSocket, Server-Sent Events, gRPC (reflection hoặc file .proto, đủ 4 kiểu stream), MQTT 3.1.1.

**Tương thích Postman**

- Collection lưu dạng Postman v2.1; import v1/v2.0/v2.1, environment, globals, data dump; export v2.1/v2.0.
- Auth Basic, Bearer, API key, Digest, OAuth 2.0 (client credentials / password), AWS SigV4, kế thừa từ folder/collection.
- Sandbox script `pm.*` (pre-request, test, chai, `pm.sendRequest`, CryptoJS…), Collection Runner với data file, xuất HTML / JUnit / JSON.
- Import/export cURL (bash, cmd, PowerShell) và code snippet cho 13 ngôn ngữ.

**Load test**

- Executor ramping VUs, arrival rate, shared iterations; preset theo loại test của k6; check, extractor (tự chuyển từ script test), threshold, data set.
- Dashboard trực tiếp và báo cáo: KPI, percentile, heatmap, phân phối, Apdex, aggregate report; so sánh run; xuất HTML / JSON / CSV / JUnit / Markdown.

**Trải nghiệm làm việc**

- Hộp thoại “Save changes?” khi đóng tab; ghim tab, “Close saved tabs”, danh sách mọi tab.
- Popover khi rê chuột lên `{{biến}}` (giá trị Current/Initial, sửa tại chỗ, che biến secret), ở cả ô nhập và editor.
- Kéo đổi kích thước khung Request/Response và cột bảng; tìm kiếm, thêm nhanh, reveal và điều hướng bằng bàn phím ở cây bên trái.
- Response cuối của mỗi tab được giữ lại sau khi khởi động lại; thông báo lỗi mạng dễ hiểu.
- Thanh trạng thái, Activity Logs, cửa sổ phím tắt (Ctrl+/), zoom, độ sáng theo theme, Settings chia mục, Help & Support, terminal tích hợp (Ctrl+`) với “Run in terminal” cho cURL.
