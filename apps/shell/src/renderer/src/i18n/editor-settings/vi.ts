import type { zh } from './zh'

export const vi = {
  sectionDesc:
    'Trình soạn thảo bị tắt sẽ biến khỏi danh sách tài liệu mới, và khi mở tệp của nó, ứng dụng sẽ hỏi có bật lại không. Tài liệu đang mở vẫn giữ nguyên.',
  aiOffKeeps:
    'Tắt AI không xóa đăng nhập, khóa, kỹ năng và cài đặt; bật lại thì mọi thứ trở lại như cũ. Lệnh terminal và MCP vẫn hoạt động.',
  aiOffAsk: 'Có {count} tác vụ AI đang chạy. Dừng chúng và tắt AI?',
  aiOffStop: 'Dừng và tắt',
  aiOffCancel: 'Hủy',
  saveFailed: 'Không thay đổi được. Hãy thử lại.',
} satisfies Record<keyof typeof zh, string>
