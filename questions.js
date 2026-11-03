/**
 * questions.js - Ngân hàng câu hỏi trắc nghiệm trực tuyến
 * Mỗi câu hỏi gồm:
 * - id: Mã câu hỏi duy nhất
 * - category: Danh mục / Chủ đề
 * - question: Nội dung câu hỏi
 * - options: Mảng các đáp án
 * - correct: Chỉ số đáp án đúng (0, 1, 2, 3) hoặc mảng chỉ số nếu là câu hỏi chọn nhiều đáp án
 * - isMultiple: true nếu chọn nhiều đáp án, false nếu chọn 1 đáp án duy nhất
 * - explanation: Giải thích chi tiết sau khi xem lại bài
 */

const QUIZ_QUESTIONS = [
    {
        id: 1,
        category: "Công nghệ Web",
        question: "Trong lập trình Web hiện đại, phương thức nào dưới đây thường được sử dụng để gửi dữ liệu nhạy cảm hoặc tạo tài nguyên mới lên máy chủ?",
        options: [
            "GET",
            "POST",
            "HEAD",
            "OPTIONS"
        ],
        correct: 1, // POST
        isMultiple: false,
        explanation: "Phương thức POST thường được sử dụng để gửi dữ liệu lên server nhằm tạo mới bản ghi hoặc truyền dữ liệu nhạy cảm trong phần thân (Request Body) thay vì hiển thị trên URL như GET."
    },
    {
        id: 2,
        category: "Khoa học máy tính",
        question: "Cấu trúc dữ liệu nào hoạt động theo nguyên lý 'Vào trước - Ra trước' (FIFO - First In, First Out)?",
        options: [
            "Ngăn xếp (Stack)",
            "Hàng đợi (Queue)",
            "Cây nhị phân (Binary Tree)",
            "Đồ thị (Graph)"
        ],
        correct: 1, // Queue
        isMultiple: false,
        explanation: "Hàng đợi (Queue) hoạt động theo nguyên tắc FIFO (First In First Out), phần tử nào được thêm vào trước sẽ được lấy ra xử lý trước."
    },
    {
        id: 3,
        category: "Kiến thức Đám Mây",
        question: "Đâu là những tính năng cốt lõi do nền tảng Supabase cung cấp? (Chọn câu đúng nhất)",
        options: [
            "Cơ sở dữ liệu quan hệ PostgreSQL với Realtime Subscription",
            "Hệ thống Authentication quản lý người dùng",
            "Lưu trữ tệp tin (Storage) và Edge Functions",
            "Tất cả các tính năng trên"
        ],
        correct: 3, // All of the above
        isMultiple: false,
        explanation: "Supabase là nền tảng BaaS (Backend-as-a-Service) mã nguồn mở hàng đầu, cung cấp đầy đủ PostgreSQL, Realtime, Auth, Storage và Edge Functions."
    },
    {
        id: 4,
        category: "Khoa học & Đời sống",
        question: "Hành tinh nào trong Hệ Mặt Trời được mệnh danh là 'Hành tinh Đỏ' do bề mặt chứa nhiều oxit sắt?",
        options: [
            "Sao Thủy (Mercury)",
            "Sao Kim (Venus)",
            "Sao Hỏa (Mars)",
            "Sao Mộc (Jupiter)"
        ],
        correct: 2, // Mars
        isMultiple: false,
        explanation: "Sao Hỏa (Mars) có màu đỏ cam đặc trưng do bề mặt của nó chứa lượng lớn oxit sắt (rỉ sét), vì thế thường được gọi là Hành tinh Đỏ."
    },
    {
        id: 5,
        category: "An toàn thông tin",
        question: "Giao thức bảo mật HTTPS sử dụng chuẩn mã hóa nào để bảo vệ dữ liệu truyền tải giữa trình duyệt và máy chủ?",
        options: [
            "SSL/TLS",
            "MD5",
            "FTP",
            "DNSSEC"
        ],
        correct: 0, // SSL/TLS
        isMultiple: false,
        explanation: "HTTPS (Hypertext Transfer Protocol Secure) sử dụng giao thức bảo mật Transport Layer Security (TLS) hoặc phiên bản tiền nhiệm của nó là Secure Sockets Layer (SSL) để mã hóa toàn bộ dữ liệu."
    },
    {
        id: 6,
        category: "Trí tuệ nhân tạo (AI)",
        question: "Khái niệm 'LLM' trong lĩnh vực trí tuệ nhân tạo hiện đại là viết tắt của thuật ngữ nào?",
        options: [
            "Linear Logic Model",
            "Large Language Model",
            "Logical Learning Method",
            "Localized Language Machine"
        ],
        correct: 1, // Large Language Model
        isMultiple: false,
        explanation: "LLM là viết tắt của 'Large Language Model' (Mô hình ngôn ngữ lớn), nền tảng tạo nên các hệ thống AI tạo sinh như Gemini, GPT-4, v.v."
    },
    {
        id: 7,
        category: "Địa lý & Văn hóa",
        question: "Đỉnh núi nào được công nhận là đỉnh núi cao nhất trên Trái Đất so với mực nước biển?",
        options: [
            "K2 (Godwin-Austen)",
            "Kangchenjunga",
            "Everest (Chomolungma)",
            "Phan Xi Păng"
        ],
        correct: 2, // Everest
        isMultiple: false,
        explanation: "Đỉnh Everest nằm trên dãy Himalaya ở biên giới giữa Nepal và Tây Tạng (Trung Quốc), cao 8.848,86 mét so với mực nước biển."
    },
    {
        id: 8,
        category: "Lập trình JavaScript",
        question: "Trong JavaScript (ES6+), từ khóa nào dùng để khai báo một biến có phạm vi khối (block-scoped) và giá trị KHÔNG thể gán lại?",
        options: [
            "var",
            "let",
            "const",
            "static"
        ],
        correct: 2, // const
        isMultiple: false,
        explanation: "Từ khóa 'const' dùng để khai báo một hằng số có phạm vi trong block `{}` và không cho phép gán lại định danh sau khi đã khởi tạo."
    },
    {
        id: 9,
        category: "Công nghệ Web",
        question: "Thuộc tính nào trong CSS3 được dùng để tạo bố cục lưới hai chiều linh hoạt (gồm hàng và cột)?",
        options: [
            "display: flex",
            "display: grid",
            "display: inline-block",
            "display: table"
        ],
        correct: 1, // display: grid
        isMultiple: false,
        explanation: "CSS Grid (`display: grid`) là hệ thống bố cục lưới 2 chiều (hàng và cột), trong khi Flexbox thường tối ưu cho bố cục 1 chiều (theo hàng hoặc theo cột)."
    },
    {
        id: 10,
        category: "Khoa học môi trường",
        question: "Khí nào chiếm tỉ lệ phần trăm thể tích lớn nhất trong bầu khí quyển của Trái Đất?",
        options: [
            "Khí Oxy (Oxygen ~21%)",
            "Khí Nitơ (Nitrogen ~78%)",
            "Khí Cacbonic (Carbon Dioxide ~0.04%)",
            "Khí Argon (~0.93%)"
        ],
        correct: 1, // Nitrogen ~78%
        isMultiple: false,
        explanation: "Khí Nitơ (N2) chiếm khoảng 78% thể tích bầu khí quyển Trái Đất, tiếp theo là Oxy (khoảng 21%), Argon và các khí khác."
    }
];

// Xuất ra biến toàn cục nếu chạy môi trường browser thuần
if (typeof window !== 'undefined') {
    window.QUIZ_QUESTIONS = QUIZ_QUESTIONS;
}
