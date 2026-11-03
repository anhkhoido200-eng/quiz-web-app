/**
 * geography_questions.js - Đề cương ôn tập kiểm tra Giữa Học Kì I - Năm học 2026 – 2027
 * Môn: Địa lí, Lớp 11 (Trung tâm GDNN - GDTX Dầu Tiếng)
 * 
 * Trọn bộ 52 câu trắc nghiệm (67 ý điểm) & 4 câu tự luận trọng tâm:
 * - PHẦN I: 39 câu trắc nghiệm nhiều phương án lựa chọn (A, B, C, D)
 * - PHẦN II: 5 câu trắc nghiệm Đúng - Sai (20 mệnh đề a, b, c, d)
 * - PHẦN III: 8 câu trả lời ngắn / điền số (Kèm công thức tính và đáp án)
 * - PHẦN IV: 4 câu tự luận (Dàn ý ôn thi đầy đủ)
 */

const rawGeographyMCQ = [
    // --- Bài 1. Sự khác biệt về trình độ phát triển kinh tế - xã hội của các nhóm nước ---
    {
        id: 1,
        category: "Bài 1: Phát triển KT-XH",
        question: "Hiện nay, hầu hết các nước đang phát triển có đặc điểm nào sau đây về quy mô GDP?",
        options: [
            "Quy mô GDP ở mức trung bình và thấp.",
            "Quy mô GDP đứng đầu toàn thế giới.",
            "Quy mô GDP có tốc độ giảm sâu liên tục.",
            "Quy mô GDP vượt trội nhóm nước phát triển."
        ],
        answer: 0,
        explanation: "Các nước đang phát triển chiếm phần lớn số lượng quốc gia trên thế giới nhưng phần lớn có quy mô GDP ở mức trung bình và thấp so với các nước phát triển."
    },
    {
        id: 2,
        category: "Bài 1: Phát triển KT-XH",
        question: "Nhóm nước phát triển có đặc điểm nào sau đây?",
        options: [
            "GNI bình quân đầu người cao.",
            "Tỉ trọng của dịch vụ trong GDP thấp.",
            "Chỉ số phát triển con người còn thấp.",
            "Tỉ trọng của nông nghiệp còn rất lớn."
        ],
        answer: 0,
        explanation: "Nhóm nước phát triển có GNI bình quân đầu người ở mức cao (thường trên 13.000 USD/người/năm), cơ cấu kinh tế hiện đại với ngành dịch vụ chiếm tỉ trọng rất cao."
    },
    {
        id: 3,
        category: "Bài 1: Phát triển KT-XH",
        question: "Dựa vào các tiêu chí chủ yếu nào sau đây để phân chia thế giới thành các nhóm nước?",
        options: [
            "Thu nhập bình quân, cơ cấu ngành kinh tế, chỉ số phát triển con người.",
            "Thu nhập bình quân, đầu tư ra nước ngoài, chỉ số phát triển con người.",
            "Cơ cấu ngành kinh tế, chỉ số phát triển con người, đầu tư ra nước ngoài.",
            "Chỉ số phát triển con người, cơ cấu ngành kinh tế và sức mạnh quân sự."
        ],
        answer: 0,
        explanation: "Các tổ chức quốc tế (LHQ, WB) phân chia các nhóm nước dựa trên 3 tiêu chí chủ yếu: Thu nhập bình quân (GNI/người), Cơ cấu ngành kinh tế và Chỉ số phát triển con người (HDI)."
    },
    {
        id: 4,
        category: "Bài 1: Phát triển KT-XH",
        question: "Các nước phát triển so với các nước đang phát triển thường có đặc điểm nào?",
        options: [
            "Tỉ lệ người biết chữ rất thấp.",
            "Chỉ số HDI vào loại rất cao.",
            "Tỉ lệ gia tăng dân số còn lớn.",
            "Tuổi thọ trung bình khá thấp."
        ],
        answer: 1,
        explanation: "Các nước phát triển có hệ thống giáo dục và y tế tiên tiến, tuổi thọ cao nên chỉ số phát triển con người (HDI) đạt mức rất cao (thường từ 0,800 trở lên)."
    },
    {
        id: 5,
        category: "Bài 1: Phát triển KT-XH",
        question: "Sản xuất nông nghiệp ở các nước phát triển có đặc điểm cơ bản nào sau đây?",
        options: [
            "Sử dụng ít lao động nhưng có tỉ lệ đóng góp vào GDP cao.",
            "Sử dụng nhiều lao động và có tỉ lệ đóng góp vào GDP cao.",
            "Sử dụng ít lao động và có tỉ lệ đóng góp vào GDP rất nhỏ.",
            "Sử dụng nhiều lao động nhưng có tỉ đóng góp vào GDP nhỏ."
        ],
        answer: 2,
        explanation: "Nông nghiệp ở các nước phát triển được cơ giới hóa và ứng dụng công nghệ cao nên sử dụng rất ít lao động và tỉ lệ đóng góp vào GDP rất nhỏ (thường chỉ 1 - 2%)."
    },
    {
        id: 6,
        category: "Bài 1: Phát triển KT-XH",
        question: "Phát biểu nào sau đây thể hiện việc các nước phát triển có trình độ phát triển kinh tế - xã hội cao hơn các nước đang phát triển?",
        options: [
            "Chiếm tỉ trọng lớn giá trị xuất khẩu của thế giới.",
            "Tỉ trọng của khu vực kinh tế dịch vụ chưa cao.",
            "Công nghiệp - xây dựng tăng trưởng rất nhanh.",
            "Tốc độ tăng trưởng nền kinh tế ở mức rất cao."
        ],
        answer: 0,
        explanation: "Các nước phát triển chiếm tỉ trọng áp đảo trong tổng giá trị xuất khẩu hàng hóa và dịch vụ chất lượng cao của toàn thế giới."
    },

    // --- Bài 2. Toàn cầu hóa và khu vực hóa kinh tế ---
    {
        id: 7,
        category: "Bài 2: Toàn cầu hóa & Khu vực hóa",
        question: "Tổ chức thương mại nào sau đây hoạt động với phạm vi quy mô toàn cầu?",
        options: [
            "Liên minh châu Âu.",
            "Hiệp hội các quốc gia Đông Nam Á.",
            "Tổ chức Thương mại Thế giới.",
            "Thị trường chung Nam Mỹ."
        ],
        answer: 2,
        explanation: "Tổ chức Thương mại Thế giới (WTO) là tổ chức thương mại duy nhất trên quy mô toàn cầu, thiết lập các hiệp định và nguyên tắc thương mại đa phương."
    },
    {
        id: 8,
        category: "Bài 2: Toàn cầu hóa & Khu vực hóa",
        question: "Nhận định nào sau đây là biểu hiện đặc trưng của xu hướng khu vực hóa kinh tế?",
        options: [
            "Hình thành các khối liên kết kinh tế như ASEAN, EU.",
            "Các dòng vốn và lao động tự do dịch chuyển khắp thế giới.",
            "Các công ty đa quốc gia chi phối các chuỗi giá trị toàn cầu.",
            "Áp dụng rộng rãi các tiêu chuẩn thống nhất trên toàn thế giới."
        ],
        answer: 0,
        explanation: "Biểu hiện đặc trưng của khu vực hóa kinh tế là sự ra đời và phát triển của các tổ chức liên kết kinh tế khu vực (như ASEAN, EU, NAFTA/USMCA, MERCOSUR,...)."
    },
    {
        id: 9,
        category: "Bài 2: Toàn cầu hóa & Khu vực hóa",
        question: "Toàn cầu hóa là quá trình liên kết các quốc gia trên thế giới không phải về",
        options: [
            "kinh tế.",
            "văn hóa.",
            "khoa học.",
            "chính trị."
        ],
        answer: 3,
        explanation: "Toàn cầu hóa diễn ra mạnh mẽ trong các lĩnh vực kinh tế, văn hóa, xã hội, khoa học kĩ thuật... nhưng mỗi quốc gia vẫn duy trì độc lập chủ quyền chính trị riêng biệt."
    },
    {
        id: 10,
        category: "Bài 2: Toàn cầu hóa & Khu vực hóa",
        question: "Sự ra đời của tổ chức nào sau đây là biểu hiện của toàn cầu hóa kinh tế?",
        options: [
            "Ngân hàng thế giới (WBG).",
            "Liên minh châu Âu (EU).",
            "Hiệp hội các quốc gia Đông Nam Á (ASEAN).",
            "Thị trường chung Nam Mỹ (MERCOSUR)."
        ],
        answer: 0,
        explanation: "Ngân hàng Thế giới (WBG) và Quỹ Tiền tệ Quốc tế (IMF) hoạt động trên phạm vi toàn cầu, hỗ trợ tín dụng và phát triển kinh tế cho các nước trên khắp thế giới."
    },
    {
        id: 11,
        category: "Bài 2: Toàn cầu hóa & Khu vực hóa",
        question: "Biểu hiện nào sau đây không thuộc toàn cầu hóa kinh tế?",
        options: [
            "Các dòng hàng hóa - dịch vụ tự do di chuyển.",
            "Giao dịch thương mại quốc tế tăng nhanh.",
            "Áp dụng rộng rãi nhiều tiêu chuẩn toàn cầu.",
            "Các tổ chức liên kết khu vực được ra đời."
        ],
        answer: 3,
        explanation: "Việc 'Các tổ chức liên kết khu vực được ra đời' là biểu hiện của xu hướng khu vực hóa kinh tế, không phải toàn cầu hóa kinh tế."
    },
    {
        id: 12,
        category: "Bài 2: Toàn cầu hóa & Khu vực hóa",
        question: "Việc áp dụng ngày càng rộng rãi các tiêu chuẩn toàn cầu trong quá trình sản xuất và kinh doanh có ý nghĩa chủ yếu nào sau đây?",
        options: [
            "Thúc đẩy sự phát triển xanh và hạn chế tuyệt đối việc phát thải khí nhà kính.",
            "Tạo điều kiện thuận lợi cho việc liên kết và hợp tác sản xuất giữa các quốc gia.",
            "Xóa bỏ sự chênh lệch về trình độ phát triển kinh tế giữa các nhóm nước.",
            "Giảm vai trò quản lí vĩ mô của chính quyền các nước đối với các dòng hàng hóa."
        ],
        answer: 1,
        explanation: "Áp dụng tiêu chuẩn chung (ISO, tiêu chuẩn an toàn, chất lượng) giúp các bộ phận sản phẩm sản xuất ở nhiều nước tương thích hoàn hảo và dễ dàng liên kết chuỗi giá trị toàn cầu."
    },

    // --- Bài 4. Một số tổ chức quốc tế, khu vực. An ninh toàn cầu ---
    {
        id: 13,
        category: "Bài 4: An ninh toàn cầu",
        question: "Duy trì hòa bình và trật tự thế giới là nhiệm vụ chủ yếu của tổ chức nào?",
        options: [
            "Tổ chức Thương mại Thế giới.",
            "Quỹ Tiền tệ quốc tế (IMF).",
            "Ngân hàng Thế giới (WB).",
            "Liên hợp quốc."
        ],
        answer: 3,
        explanation: "Mục tiêu và nhiệm vụ hàng đầu của Liên hợp quốc (UN) là duy trì hòa bình, an ninh quốc tế và ngăn chặn xung đột vũ trang trên thế giới."
    },
    {
        id: 14,
        category: "Bài 4: An ninh toàn cầu",
        question: "Liên hợp quốc được thành lập năm nào sau đây?",
        options: [
            "1918.",
            "1939.",
            "1945.",
            "1975."
        ],
        answer: 2,
        explanation: "Liên hợp quốc được chính thức thành lập vào ngày 24-10-1945 sau khi Hiến chương Liên hợp quốc có hiệu lực."
    },
    {
        id: 15,
        category: "Bài 4: An ninh toàn cầu",
        question: "Việt Nam là thành viên của Quỹ tiền tệ quốc tế (IMF) vào năm nào sau đây?",
        options: [
            "1977.",
            "1976.",
            "2007.",
            "1998."
        ],
        answer: 1,
        explanation: "Việt Nam chính thức kế tục tư cách thành viên tại Quỹ Tiền tệ Quốc tế (IMF) từ năm 1976."
    },
    {
        id: 16,
        category: "Bài 4: An ninh toàn cầu",
        question: "Việc bảo đảm số lượng, chất lượng nước phục vụ dân sinh trong mọi tình huống được gọi là",
        options: [
            "an ninh lương thực.",
            "an ninh nguồn nước.",
            "an ninh môi trường.",
            "an ninh tài nguyên."
        ],
        answer: 1,
        explanation: "An ninh nguồn nước là việc bảo đảm về số lượng, chất lượng nước để phục vụ dân sinh và phát triển kinh tế - xã hội bền vững trong mọi hoàn cảnh."
    },
    {
        id: 17,
        category: "Bài 4: An ninh toàn cầu",
        question: "Khu vực nào sau đây chịu ảnh hưởng nặng nề nhất của nạn đói?",
        options: [
            "Tây Âu.",
            "Bắc Á.",
            "Đông Phi.",
            "Bắc Mĩ."
        ],
        answer: 2,
        explanation: "Đông Phi là khu vực chịu nạn đói và mất an ninh lương thực nghiêm trọng nhất thế giới do hạn hán kéo dài, xung đột vũ trang và nghèo đói."
    },
    {
        id: 18,
        category: "Bài 4: An ninh toàn cầu",
        question: "Mất an ninh lương thực dẫn tới hệ quả trực tiếp chủ yếu nào sau đây?",
        options: [
            "Làm phức tạp các vấn đề xung đột.",
            "Gia tăng nạn khủng bố trên thế giới.",
            "Làm suy giảm chất lượng cuộc sống.",
            "Đẩy nhanh tốc độ biến đổi khí hậu."
        ],
        answer: 2,
        explanation: "Mất an ninh lương thực trực tiếp gây suy dinh dưỡng, bệnh tật, giảm sức lao động và làm suy giảm nghiêm trọng chất lượng cuộc sống của con người."
    },
    {
        id: 19,
        category: "Bài 4: An ninh toàn cầu",
        question: "Giải pháp quan trọng nhất để đảm bảo an ninh năng lượng và phát triển bền vững ở các quốc gia là",
        options: [
            "tăng cường sử dụng các nguồn năng lượng tái tạo.",
            "chủ động kiểm soát tốt việc sử dụng năng lượng.",
            "phát huy vai trò các tổ chức năng lượng quốc tế.",
            "hạn chế tốt việc sử dụng các nguồn năng lượng."
        ],
        answer: 0,
        explanation: "Chuyển dịch sang các nguồn năng lượng tái tạo (mặt trời, gió, thủy triều, sinh khối...) là giải pháp căn cơ và bền vững nhất để thay thế nhiên liệu hóa thạch đang dần cạn kiệt."
    },
    {
        id: 20,
        category: "Bài 4: An ninh toàn cầu",
        question: "Tại sao phải bảo vệ hòa bình thế giới?",
        options: [
            "Giúp tăng trưởng kinh tế và tạo ra sự thịnh vượng chung.",
            "Đảm bảo quyền bình đẳng về phát triển giữa các dân tộc.",
            "Giải quyết được tình trạng đói nghèo, xung đột vũ trang.",
            "Tránh xảy ra tranh chấp biên giới, lãnh thổ các quốc gia."
        ],
        answer: 0,
        explanation: "Hòa bình là điều kiện tiên quyết để ổn định xã hội, thúc đẩy phát triển kinh tế toàn cầu và đem lại sự phồn vinh, hạnh phúc cho nhân loại."
    },
    {
        id: 21,
        category: "Bài 4: An ninh toàn cầu",
        question: "Là quốc gia nằm ở hạ lưu sông Mê Công, để chủ động bảo vệ an ninh nguồn nước và hạn chế tối đa các tác động tiêu cực do việc xây dựng các công trình ở thượng nguồn, giải pháp có tính chiến lược quốc tế của Việt Nam là",
        options: [
            "xây dựng thêm nhiều đập thủy điện công suất lớn ở hạ nguồn sông Mê Công.",
            "ngăn chặn việc thông thương và trao đổi hàng hóa với các nước thượng nguồn.",
            "tăng cường hợp tác và thực hiện nghiêm túc các cam kết trong Ủy hội sông Mê Công.",
            "chuyển đổi toàn bộ diện tích trồng lúa nước sang phát triển công nghiệp khai khoáng."
        ],
        answer: 2,
        explanation: "Việt Nam cần tăng cường đối thoại, hợp tác và giám sát việc chia sẻ nguồn nước công bằng thông qua Ủy hội sông Mê Công (MRC) cùng các cơ chế quốc tế liên quan."
    },
    {
        id: 22,
        category: "Bài 4: An ninh toàn cầu",
        question: "Tại sao phải chú ý tới vấn đề an ninh toàn cầu?",
        options: [
            "Là thách thức đặt ra đối với toàn thế giới.",
            "Gia tăng nhanh khoảng cách giàu nghèo.",
            "Tác động mạnh mẽ bởi cuộc cách mạng 4.0.",
            "Nền kinh tế của thế giới bị suy thoái nhanh."
        ],
        answer: 0,
        explanation: "Các vấn đề an ninh toàn cầu (an ninh năng lượng, lương thực, nguồn nước, an ninh mạng, biến đổi khí hậu...) không biên giới và là thách thức chung đối với mọi quốc gia."
    },

    // --- Bài 6 + 7. Khu vực Mỹ Latinh ---
    {
        id: 23,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Thảm thực vật nào sau đây ở khu vực Mỹ La-tinh được mệnh danh là “lá phổi xanh” của Trái Đất?",
        options: [
            "Rừng cận nhiệt đới phía nam Ác-hen-ti-na.",
            "Xavan và rừng thưa trên sơn nguyên Bra-xin.",
            "Rừng mưa nhiệt đới A-ma-dôn.",
            "Rừng lá kim trên vùng núi cao An-đét."
        ],
        answer: 2,
        explanation: "Rừng mưa nhiệt đới A-ma-dôn là khu rừng nhiệt đới lớn nhất hành tinh, cung cấp khoảng 20% lượng oxy và lưu trữ lượng carbon khổng lồ cho Trái Đất."
    },
    {
        id: 24,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Khu vực Mỹ La-tinh gồm những bộ phận nào?",
        options: [
            "Mê-hi-cô, Trung và Bắc Mỹ, các quần đảo trong biển Ca-ri-bê.",
            "Mê-hi-cô, Trung và Nam Mỹ, các quần đảo trong biển Ca-ri-bê.",
            "Mê-hi-cô, Trung và Nam Mỹ, quần đảo Ăng-ti, kênh đào Xuy-ê.",
            "Mê-hi-cô, Trung và Bắc Mỹ, kênh đào Xuy-ê và kênh Pa-na-ma."
        ],
        answer: 1,
        explanation: "Khu vực Mỹ Latinh bao gồm: Mê-hi-cô (Bắc Mỹ), eo đất Trung Mỹ, toàn bộ lục địa Nam Mỹ và các quần đảo trong vùng biển Ca-ri-bê."
    },
    {
        id: 25,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Phía bắc khu vực Mỹ La-tinh tiếp giáp với",
        options: [
            "Hoa Kỳ.",
            "Ca-na-đa.",
            "quần đảo Ăng-ti lớn.",
            "quần đảo Ăng-ti nhỏ."
        ],
        answer: 0,
        explanation: "Phía bắc của khu vực Mỹ Latinh (cụ thể là Mê-hi-cô) tiếp giáp trực tiếp với Hợp chủng quốc Hoa Kỳ (thị trường tiêu thụ lớn nhất thế giới)."
    },
    {
        id: 26,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Khu vực Mỹ La-tinh có đặc điểm dân số như thế nào?",
        options: [
            "Dân số ít, cơ cấu dân số rất già.",
            "Gia tăng dân số rất cao, dân trẻ.",
            "Dân số đông và cơ cấu già hóa.",
            "Gia tăng dân số rất nhỏ, dân già."
        ],
        answer: 2,
        explanation: "Mỹ Latinh hiện có quy mô dân số đông (khoảng trên 660 triệu người) và đang trong quá trình chuyển biến già hóa dân số nhanh chóng."
    },
    {
        id: 27,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Lợi thế chủ yếu nhất để các nước Mỹ La-tinh có thể phát triển các cây công nghiệp có nguồn gốc nhiệt đới là",
        options: [
            "thị trường tiêu thụ rộng lớn.",
            "có nhiều loại đất khác nhau.",
            "các cao nguyên bằng phẳng.",
            "phần lớn có khí hậu nóng ẩm."
        ],
        answer: 3,
        explanation: "Đại bộ phận lãnh thổ Mỹ Latinh nằm trong đới nóng với khí hậu xích đạo, cận xích đạo và nhiệt đới nóng ẩm quanh năm, rất thuận lợi cho cây trồng nhiệt đới (cà phê, mía, cao su, ca cao...)."
    },
    {
        id: 28,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Phát biểu nào sau đây không đúng với tự nhiên của Mĩ La-tinh?",
        options: [
            "Cảnh quan thiên nhiên đa dạng.",
            "Tài nguyên khoáng sản phong phú.",
            "Có nhiều khoáng sản kim loại màu.",
            "Hầu hết lãnh thổ có khí hậu ôn đới lục địa."
        ],
        answer: 3,
        explanation: "Phát biểu sai là D vì phần lớn lãnh thổ Mỹ Latinh thuộc đới khí hậu nhiệt đới và cận xích đạo; chỉ có phần phía nam Nam Mỹ mới có khí hậu cận nhiệt và ôn đới."
    },
    {
        id: 30,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Hiện tượng “đô thị hóa tự phát” ở khu vực Mỹ La-tinh phản ánh điều nào sau đây về mối quan hệ giữa kinh tế và đô thị hóa?",
        options: [
            "Đô thị hóa diễn ra chậm hơn nhiều so với tốc độ tăng trưởng kinh tế trung bình.",
            "Sự phát triển đồng bộ giữa quá trình công nghiệp hóa và hiện đại hóa đất nước.",
            "Nền kinh tế phát triển mạnh mẽ thúc đẩy sự thay đổi nhanh chóng bộ mặt đô thị.",
            "Tốc độ đô thị hóa vượt trước trình độ phát triển kinh tế - xã hội của khu vực."
        ],
        answer: 3,
        explanation: "Đô thị hóa tự phát xảy ra do làn sóng di dân ồ ạt từ nông thôn ra các thành phố kiếm sống trong khi công nghiệp chưa đủ khả năng giải quyết việc làm, khiến tốc độ đô thị hóa vượt trước trình độ phát triển kinh tế."
    },
    {
        id: 31,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Vấn đề dân cư - xã hội đáng quan tâm nhất ở Mỹ La-tinh là",
        options: [
            "có nhiều siêu đô thị dân đông.",
            "tỉ lệ thất nghiệp ở thành thị cao.",
            "dân nông thôn vào đô thị đông.",
            "chênh lệch giàu nghèo rất lớn."
        ],
        answer: 3,
        explanation: "Mỹ Latinh là khu vực có mức độ bất bình đẳng và chênh lệch giàu nghèo lớn nhất thế giới, dẫn đến nhiều hệ lụy xã hội phức tạp."
    },
    {
        id: 32,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Các nước ở vùng biển Ca-ri-bê có thuận lợi chủ yếu cho phát triển các cây trồng có nguồn gốc",
        options: [
            "nhiệt đới và cận xích đạo.",
            "ôn đới và cận nhiệt đới.",
            "cận nhiệt đới và cận cực.",
            "cận cực và cận nhiệt đới."
        ],
        answer: 0,
        explanation: "Khu vực quần đảo Ca-ri-bê nằm hoàn toàn trong vành đai nội chí tuyến, khí hậu nhiệt đới hải dương ẩm ướt, thích hợp trồng mía đường, chuối, cà phê, cây ăn quả nhiệt đới."
    },
    {
        id: 33,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Thiên nhiên vùng núi An-đét đa dạng chủ yếu do",
        options: [
            "dãy núi kéo dài nhiều vĩ độ, có sự phân chia hai sườn rõ rệt.",
            "dãy núi kéo dài, có độ cao lớn và phân chia ở hai sườn rõ rệt.",
            "dãy núi trẻ cao, đồ sộ, có địa hình thung lũng và cao nguyên.",
            "dãy núi trẻ, kéo dài theo bắc - nam, phân chia hai sườn rõ rệt."
        ],
        answer: 1,
        explanation: "Dãy An-đét kéo dài gần 9.000 km qua nhiều vĩ độ, có độ cao lớn (nhiều đỉnh trên 6.000m) tạo nên các vành đai thực vật theo độ cao, đồng thời phân hóa sâu sắc giữa sườn đón gió và sườn khuất gió."
    },
    {
        id: 34,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Khu vực Mỹ La-tinh có kinh tế còn chậm phát triển chủ yếu do",
        options: [
            "chính trị thiếu ổn định, dịch bệnh, nợ nước ngoài nhiều.",
            "bạo lực và tệ nạn ma tuý, dân trí chưa cao, tham nhũng.",
            "lạm phát, nạn tham nhũng, tỉ lệ thất nghiệp còn khá lớn.",
            "quản lí yếu, gắn kết trong khu vực yếu, nạn tham nhũng."
        ],
        answer: 0,
        explanation: "Tình hình chính trị bất ổn định kéo dài, các đợt dịch bệnh và gánh nặng nợ nước ngoài quá lớn là những nguyên nhân cốt lõi kìm hãm sự bứt phá kinh tế của khu vực."
    },
    {
        id: 35,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Tiềm năng tự nhiên lớn nhất ở dãy An-đét cho phát triển kinh tế là",
        options: [
            "khoáng sản, thủy điện.",
            "thủy điện, đất trồng.",
            "đất trồng, sinh vật.",
            "sinh vật, khoáng sản."
        ],
        answer: 0,
        explanation: "Vùng núi An-đét rất giàu khoáng sản kim loại màu (đồng, chì, kẽm, bạc, thiếc) và hệ thống sông dốc có tiềm năng thủy điện khổng lồ."
    },
    {
        id: 36,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Số dân đô thị ở khu vực Mỹ La-tinh tăng nhanh chủ yếu do",
        options: [
            "di cư từ nông thôn đến và gia tăng tự nhiên.",
            "lao động kĩ thuật gia tăng và tỉ suất sinh cao.",
            "nhập cư từ châu lục khác đến nhiều, di cư ít.",
            "lao động ở khu vực dịch vụ tăng và nhập cư."
        ],
        answer: 0,
        explanation: "Dân số đô thị tăng nhanh xuất phát từ sự bùng nổ di cư từ nông thôn do thiếu đất canh tác kết hợp với tỉ lệ gia tăng tự nhiên của dân số đô thị."
    },
    {
        id: 37,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Sản phẩm nông nghiệp nổi bật nhất của Mỹ La-tinh là",
        options: [
            "lương thực.",
            "cây công nghiệp.",
            "thực phẩm.",
            "gia súc."
        ],
        answer: 1,
        explanation: "Mỹ Latinh nổi tiếng thế giới về xuất khẩu các sản phẩm cây công nghiệp lâu năm và hàng năm như cà phê, đậu tương, mía, ca cao, chuối."
    },
    {
        id: 38,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Vùng biển Mỹ La-tinh thuận lợi cho phát triển nghề cá do đặc điểm chủ yếu nào sau đây?",
        options: [
            "Vùng biển rộng, phần lớn có khí hậu nhiệt đới.",
            "Vùng biển rộng, có nhiều ngư trường rộng lớn.",
            "Vùng biển nông, có nhiều vũng vịnh và hải đảo.",
            "Có nhiều vũng vịnh, hải đảo và nóng quanh năm."
        ],
        answer: 1,
        explanation: "Vùng biển Mỹ Latinh giáp cả Thái Bình Dương và Đại Tây Dương với các dòng hải lưu tạo nên những ngư trường hải sản rộng lớn và trù phú bậc nhất (đặc biệt là vùng biển Pê-ru)."
    },
    {
        id: 39,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Các đồng bằng ven vịnh Mê-hi-cô có thuận lợi chủ yếu để phát triển những ngành nào sau đây?",
        options: [
            "Khai thác quặng sắt, chăn nuôi, du lịch.",
            "Khai thác dầu khí, đánh bắt cá, du lịch.",
            "Khai thác vàng, chăn nuôi, lâm nghiệp.",
            "Khai thác dầu khí, trồng trọt và du lịch."
        ],
        answer: 3,
        explanation: "Khu vực thềm lục địa vịnh Mê-hi-cô có trữ lượng dầu khí dồi dào, đồng bằng màu mỡ thuận lợi phát triển trồng trọt nhiệt đới và các bãi biển phát triển du lịch."
    },
    {
        id: 40,
        category: "Bài 6 + 7: Khu vực Mỹ Latinh",
        question: "Để giải quyết triệt để tình trạng nợ nước ngoài lớn và giảm bớt sự lệ thuộc kinh tế vào bên ngoài, giải pháp mang tính đột phá và bền vững nhất mà các quốc gia Mỹ La-tinh cần thực hiện là",
        options: [
            "tập trung khai thác và xuất khẩu khoáng sản thô để tích lũy nhiều ngoại tệ.",
            "cải cách kinh tế, phát triển công nghiệp chế biến sâu và đa dạng hóa đối tác.",
            "thực hiện chính sách đóng cửa nền kinh tế để tối đa hóa tiêu dùng nội địa.",
            "ngừng tiếp nhận toàn bộ các nguồn vốn đầu tư trực tiếp từ các nước phát triển."
        ],
        answer: 1,
        explanation: "Phát triển công nghiệp chế biến sâu giúp nâng cao giá trị hàng xuất khẩu, chấm dứt tình trạng bán thô giá rẻ, kết hợp cải cách kinh tế và mở rộng quan hệ đối tác đa phương."
    }
];

const rawGeographyTrueFalse = [
    {
        id: 41,
        category: "Địa Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 1: Cho thông tin sau:\nCác tổ chức quốc tế như Tổ chức Thương mại Thế giới (WTO), Quỹ Tiền tệ Quốc tế (IMF), Ngân hàng Thế giới (WB) đóng vai trò quan trọng trong việc thúc đẩy toàn cầu hoá kinh tế. Đến năm 2024, WTO có 166 thành viên và Việt Nam là thành viên thứ 150 của tổ chức này từ năm 2007.",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Một trong những mục tiêu chính của WTO là thúc đẩy tăng trưởng thương mại hàng hoá và dịch vụ trên toàn cầu.",
                answer: true,
                explanation: "ĐÚNG. Mục tiêu cốt lõi của WTO là tự do hoá thương mại, dỡ bỏ rào cản thuế quan và phi thuế quan nhằm tăng trưởng thương mại toàn cầu."
            },
            {
                key: "b",
                label: "b",
                text: "Quỹ Tiền tệ Quốc tế (IMF) đóng vai trò duy trì sự ổn định của hệ thống tiền tệ và hỗ trợ tài chính cho các thành viên.",
                answer: true,
                explanation: "ĐÚNG. IMF giám sát hệ thống tài chính tiền tệ quốc tế và cung cấp các gói vay hỗ trợ cán cân thanh toán cho các nước hội viên khi gặp khủng hoảng."
            },
            {
                key: "c",
                label: "c",
                text: "Tất cả các quốc gia khi gia nhập WTO đều phải tuân thủ các nguyên tắc tự do hoá thương mại và minh bạch hoá.",
                answer: true,
                explanation: "ĐÚNG. Minh bạch hoá chính sách và tuân thủ các nguyên tắc không phân biệt đối xử (MFN, NT) là yêu cầu bắt buộc đối với mọi thành viên WTO."
            },
            {
                key: "d",
                label: "d",
                text: "Việc trở thành thành viên của WTO giúp các doanh nghiệp trong nước tránh được hoàn toàn rủi ro từ các vụ kiện thương mại.",
                answer: false,
                explanation: "SAI. Gia nhập WTO không loại trừ hoàn toàn rủi ro; trái lại doanh nghiệp phải đối diện với sự cạnh tranh gay gắt hơn và các vụ kiện phòng vệ thương mại (chống bán phá giá, chống trợ cấp, rào cản kĩ thuật)."
            }
        ]
    },
    {
        id: 42,
        category: "Địa Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 2: Cho thông tin sau:\nToàn cầu hoá kinh tế là sự gia tăng nhanh chóng các hoạt động kinh tế vượt qua mọi biên giới quốc gia và khu vực trên toàn thế giới; tạo ra sự phụ thuộc lẫn nhau giữa các nền kinh tế nhằm hướng tới nền kinh tế thế giới hội nhập và thống nhất.",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Toàn cầu hoá là quá trình liên kết các quốc gia trên thế giới về nhiều mặt.",
                answer: true,
                explanation: "ĐÚNG. Toàn cầu hóa liên kết các nước trên mọi bình diện: kinh tế, văn hóa, khoa học công nghệ, môi trường, xã hội."
            },
            {
                key: "b",
                label: "b",
                text: "Toàn cầu hoá tác động mạnh mẽ đến mọi mặt của nền kinh tế - xã hội thế giới.",
                answer: true,
                explanation: "ĐÚNG. Toàn cầu hóa tạo động lực tăng trưởng kinh tế, chuyển dịch cơ cấu ngành nhưng cũng đặt ra nhiều thách thức về môi trường và an sinh xã hội."
            },
            {
                key: "c",
                label: "c",
                text: "Toàn cầu hoá làm gia tăng sự phụ thuộc lẫn nhau giữa các nền kinh tế.",
                answer: true,
                explanation: "ĐÚNG. Chuỗi cung ứng toàn cầu đan xen khiến khủng hoảng ở một quốc gia có thể nhanh chóng lan tỏa và ảnh hưởng trực tiếp đến các quốc gia khác."
            },
            {
                key: "d",
                label: "d",
                text: "Toàn cầu hoá làm tăng nguy cơ bất ổn về chính trị và gia tăng chiến tranh.",
                answer: false,
                explanation: "SAI. Toàn cầu hóa thúc đẩy đối thoại, phụ thuộc kinh tế lẫn nhau tạo nên xu thế hòa bình, hữu nghị, hợp tác cùng phát triển chứ không phải gia tăng chiến tranh."
            }
        ]
    },
    {
        id: 43,
        category: "Địa Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 3: Cho thông tin sau:\nLiên hợp quốc (United Nations, viết tắt là UN) ra đời vào ngày 24-10-1945. Đến năm 2025, UN có 193 thành viên. Trụ sở của UN đặt ở Niu Y-oóc (Hoa Kỳ).",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Liên Hiệp Quốc được thành lập năm 1945.",
                answer: true,
                explanation: "ĐÚNG. Hiến chương Liên hợp quốc có hiệu lực vào ngày 24 tháng 10 năm 1945."
            },
            {
                key: "b",
                label: "b",
                text: "Là tổ chức có số lượng thành viên đông nhất.",
                answer: true,
                explanation: "ĐÚNG. Với 193 quốc gia thành viên chính thức, UN là tổ chức toàn cầu có quy mô thành viên lớn nhất hành tinh."
            },
            {
                key: "c",
                label: "c",
                text: "Trụ sở của Liên Hiệp quốc đặt tại Oa-Sinh-Tơn (Hoa Kỳ).",
                answer: false,
                explanation: "SAI. Trụ sở chính thức của Liên hợp quốc đặt tại thành phố New York (Niu Y-oóc, Hoa Kỳ), không phải tại thủ đô Washington D.C. (Oa-sinh-tơn)."
            },
            {
                key: "d",
                label: "d",
                text: "Mục tiêu chính của Liên hợp quốc là duy trì hoà bình và an ninh quốc tế.",
                answer: true,
                explanation: "ĐÚNG. Mục tiêu số 1 ghi trong Điều 1 Hiến chương LHQ là duy trì hòa bình và an ninh thế giới."
            }
        ]
    },
    {
        id: 44,
        category: "Địa Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 4: Cho bảng số liệu:\nSản lượng dầu mỏ và điện của thế giới, giai đoạn 2000 - 2024\n• Năm 2000: Dầu mỏ 3605,5 triệu tấn; Điện 1555,3 tỉ kWh\n• Năm 2010: Dầu mỏ 3983,4 triệu tấn; Điện 21570,7 tỉ kWh\n• Năm 2015: Dầu mỏ 4362,9 triệu tấn; Điện 24266,3 tỉ kWh\n• Năm 2024: Dầu mỏ 4120,0 triệu tấn; Điện 31255,9 tỉ kWh",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Sản lượng dầu mỏ của thế giới tăng liên tục qua các năm.",
                answer: false,
                explanation: "SAI. Dầu mỏ không tăng liên tục vì giai đoạn 2015 - 2024 đã giảm từ 4362,9 triệu tấn xuống còn 4120,0 triệu tấn."
            },
            {
                key: "b",
                label: "b",
                text: "Trong giai đoạn 2000 - 2024, sản lượng điện có tốc độ tăng nhanh hơn sản lượng dầu mỏ.",
                answer: true,
                explanation: "ĐÚNG. Điện tăng hơn 20 lần (31255,9 / 1555,3 ≈ 20,1 lần), trong khi dầu mỏ chỉ tăng 1,14 lần (4120,0 / 3605,5 ≈ 1,14 lần)."
            },
            {
                key: "c",
                label: "c",
                text: "Sản lượng điện thế giới tăng nhanh do có nhiều tiềm năng phát triển và nhu cầu tiêu thụ lớn.",
                answer: true,
                explanation: "ĐÚNG. Quá trình công nghiệp hóa, điện khí hóa và cuộc cách mạng công nghệ 4.0 thúc đẩy nhu cầu sử dụng điện tăng vọt trên toàn cầu."
            },
            {
                key: "d",
                label: "d",
                text: "Biểu đồ tròn là dạng biểu đồ thích hợp nhất để thể hiện tốc độ tăng trưởng sản lượng dầu mỏ và điện của thế giới, giai đoạn 2000 - 2024.",
                answer: false,
                explanation: "SAI. Để thể hiện tốc độ tăng trưởng của các đại lượng qua một chuỗi các năm (giai đoạn 2000 - 2024), biểu đồ thích hợp nhất là biểu đồ đường (hoặc biểu đồ cột), không phải biểu đồ tròn."
            }
        ]
    },
    {
        id: 45,
        category: "Địa Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 5: Cho thông tin sau:\nAn ninh lương thực và an ninh năng lượng là những vấn đề an ninh phi truyền thống mang tính cấp bách toàn cầu. An ninh lương thực đảm bảo quyền tiếp cận nguồn lương thực đầy đủ và an toàn, trong khi an ninh năng lượng đảm bảo cung cấp đủ năng lượng cho các hoạt động kinh tế – xã hội.",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Biến đổi khí hậu và thiên tai là những nhân tố gây ra tình trạng mất an ninh lương thực toàn cầu hiện nay.",
                answer: true,
                explanation: "ĐÚNG. Hạn hán, bão lũ, xâm nhập mặn do biến đổi khí hậu tàn phá mùa màng, làm suy giảm nguồn cung cấp lương thực tại nhiều khu vực."
            },
            {
                key: "b",
                label: "b",
                text: "Để đảm bảo an ninh năng lượng, các nước cần ưu tiên khai thác triệt để các nguồn tài nguyên hoá thạch truyền thống.",
                answer: false,
                explanation: "SAI. Khai thác cạn kiệt nhiên liệu hóa thạch gây ô nhiễm và cạn kiệt nguồn dự trữ. Giải pháp phát triển bền vững là sử dụng năng lượng tiết kiệm và chuyển dịch sang năng lượng tái tạo."
            },
            {
                key: "c",
                label: "c",
                text: "Giải quyết vấn đề an ninh lương thực đòi hỏi sự phối hợp và hỗ trợ nhân đạo giữa các khu vực trên thế giới.",
                answer: true,
                explanation: "ĐÚNG. An ninh lương thực là vấn đề toàn cầu đòi hỏi sự chung tay của Chương trình Lương thực Thế giới (WFP), FAO và sự hỗ trợ giữa các quốc gia."
            },
            {
                key: "d",
                label: "d",
                text: "Chuyển dịch cơ cấu sang năng lượng tái tạo là giải pháp quan trọng để các quốc gia thích ứng với an ninh năng lượng.",
                answer: true,
                explanation: "ĐÚNG. Phát triển điện gió, mặt trời, sinh khối giúp các nước tự chủ nguồn năng lượng sạch và giảm sự phụ thuộc vào nhập khẩu dầu mỏ, khí đốt."
            }
        ]
    }
];

const rawGeographyShortAnswer = [
    {
        id: 46,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 1: Tổng dự trữ quốc tế của An-giê-ri và Nhật Bản năm 2024 lần lượt là 68448 triệu USD và 1159702 triệu USD. Hãy cho biết tổng dự trữ quốc tế năm 2024 của Nhật Bản gấp bao nhiêu lần tổng dự trữ quốc tế của An-giê-ri (làm tròn kết quả đến một chữ số thập phân).",
        correctValue: "16.9",
        acceptedValues: ["16.9", "16,9", "16.9 lần", "16,9 lần"],
        explanation: "Công thức tính: Số lần = Dự trữ Nhật Bản / Dự trữ An-giê-ri = 1159702 / 68448 ≈ 16,9427... Làm tròn đến một chữ số thập phân: 16,9 lần."
    },
    {
        id: 47,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 2: Cho bảng số liệu: Tỉ lệ dân thành thị của Ca-na-đa năm 1990 là 77,0% và năm 2024 là 82,7%. Căn cứ vào bảng số liệu, hãy cho biết tỉ lệ dân thành thị của Ca-na-đa tăng thêm bao nhiêu phần trăm trong giai đoạn 1990 - 2024 (làm tròn kết quả đến một chữ số thập phân).",
        correctValue: "5.7",
        acceptedValues: ["5.7", "5,7", "5.7%", "5,7%"],
        explanation: "Công thức tính: Mức tăng = Tỉ lệ năm 2024 - Tỉ lệ năm 1990 = 82,7% - 77,0% = 5,7%."
    },
    {
        id: 48,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 3: Năm 2021 thế giới có khoảng 2,3 tỉ người bị đói thiếu dinh dưỡng, chiếm 29,3% dân số thế giới. Vậy dân số thế giới năm 2021 là bao nhiêu tỉ người? (Làm tròn kết quả đến số thập phân thứ nhất).",
        correctValue: "7.8",
        acceptedValues: ["7.8", "7,8", "7.8 tỉ người", "7,8 tỉ người", "7.8 tỉ", "7,8 tỉ"],
        explanation: "Công thức tính: Dân số thế giới = (Số người bị đói) / (Tỉ lệ %) = 2,3 / 29,3% = 2,3 / 0,293 ≈ 7,8498... tỉ người. Làm tròn đến chữ số thập phân thứ nhất: 7,8 tỉ người."
    },
    {
        id: 49,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 4: Năm 2024, số dân của Bra-xin là 212 triệu người, diện tích là 8,5 triệu km². Hãy cho biết mật độ dân số của Bra-xin năm 2024 là bao nhiêu người/km² (làm tròn kết quả đến hàng đơn vị).",
        correctValue: "25",
        acceptedValues: ["25", "25 người/km2", "25 người/km²"],
        explanation: "Công thức tính: Mật độ dân số = Dân số / Diện tích = 212 / 8,5 ≈ 24,941... người/km². Làm tròn đến hàng đơn vị: 25 người/km²."
    },
    {
        id: 50,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 5: Năm 2024, số dân thế giới là 8141,8 triệu người, sản lượng lương thực có hạt của thế giới là 2854 triệu tấn. Hãy cho biết bình quân lương thực có hạt theo đầu người của thế giới năm 2024 là bao nhiêu kg/người. (Làm tròn kết quả đến hàng đơn vị).",
        correctValue: "351",
        acceptedValues: ["351", "351 kg/người", "351kg/người"],
        explanation: "Đổi 2854 triệu tấn = 2.854.000 triệu kg. Bình quân lương thực = 2.854.000 / 8141,8 ≈ 350,536... kg/người. Làm tròn đến hàng đơn vị: 351 kg/người."
    },
    {
        id: 51,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 6: Biết diện tích của khu vực Mỹ Latinh là 20 triệu km², diện tích rừng năm 2024 là 9,27 triệu km². Hãy cho biết tỉ lệ che phủ rừng của khu vực Mỹ Latinh là bao nhiêu phần trăm (làm tròn kết quả đến một chữ số thập phân).",
        correctValue: "46.4",
        acceptedValues: ["46.4", "46,4", "46.4%", "46,4%"],
        explanation: "Công thức tính: Tỉ lệ che phủ rừng = (Diện tích rừng / Diện tích khu vực) × 100% = (9,27 / 20) × 100% = 46,35%. Làm tròn đến chữ số thập phân thứ nhất: 46,4%."
    },
    {
        id: 52,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 7: Biết tổng GDP Mỹ La-tinh năm 2020 là 4700 tỉ USD, trong đó, ngành dịch vụ chiếm 60,3% GDP. Tính giá trị của ngành dịch vụ năm 2020 là bao nhiêu tỉ USD. (Làm tròn kết quả đến hàng đơn vị của tỉ USD).",
        correctValue: "2834",
        acceptedValues: ["2834", "2834 tỉ USD", "2834 tỷ USD", "2834 tỉ", "2834 tỷ"],
        explanation: "Công thức tính: Giá trị dịch vụ = Tổng GDP × 60,3% = 4700 × 0,603 = 2834,1 tỉ USD. Làm tròn đến hàng đơn vị: 2834 tỉ USD."
    },
    {
        id: 53,
        category: "Địa Lí 11: Điền số",
        qType: "short_answer",
        question: "Câu 8: Biết tổng giá trị xuất nhập của Mỹ Latinh năm 2021 là 223,5 tỉ USD. Cán cân xuất nhập khẩu của Mỹ Latinh đạt 187,4 tỉ USD vào năm 2021. Tính giá trị xuất khẩu của Mỹ Latinh vào năm 2021. (Làm tròn kết quả đến hàng đơn vị của tỉ USD).",
        correctValue: "205",
        acceptedValues: ["205", "205.5", "205,45", "205.45", "205 tỉ USD", "205 tỷ USD"],
        explanation: "Ta có hệ thức: Xuất khẩu + Nhập khẩu = 223,5 tỉ USD; Xuất khẩu - Nhập khẩu = 187,4 tỉ USD. => Giá trị xuất khẩu = (223,5 + 187,4) / 2 = 410,9 / 2 = 205,45 tỉ USD. Làm tròn đến hàng đơn vị: 205 tỉ USD."
    }
];

// Dàn ý 4 câu Tự luận trọng tâm chuẩn GDPT 2018 chi tiết
const rawGeographyEssayOutlines = [
    {
        id: "essay_1",
        title: "Câu 1: Nêu đặc điểm vị trí địa lí và phạm vi lãnh thổ của khu vực Mỹ Latinh?",
        content: `
1. Phạm vi lãnh thổ:
• Mỹ Latinh là một không gian địa lí rộng lớn với diện tích khoảng 20 triệu km² (chiếm gần 15% diện tích đất nổi của Trái Đất).
• Lãnh thổ trải dài trên nhiều vĩ độ, từ khoảng 33°B đến gần 54°N.
• Bao gồm 4 bộ phận chính: Mê-hi-cô (Bắc Mỹ), eo đất Trung Mỹ, toàn bộ lục địa Nam Mỹ và các quần đảo trong vùng biển Ca-ri-bê (quần đảo Ăng-ti Lớn, Ăng-ti Nhỏ, Ba-ha-mát).

2. Vị trí địa lí:
• Tọa độ & Bán cầu: Nằm hoàn toàn ở Bán cầu Tây, tách biệt rõ rệt với lục địa Á - Âu - Phi.
• Tiếp giáp:
   + Phía bắc: Tiếp giáp trực tiếp với Hợp chúng quốc Hoa Kỳ (thị trường kinh tế lớn hàng đầu thế giới).
   + Phía đông: Tiếp giáp Đại Tây Dương rộng lớn.
   + Phía tây: Tiếp giáp Thái Bình Dương.
   + Phía nam: Tiếp giáp vùng biển Nam Đại Dương (vùng biển Nam Cực qua eo biển Đrây-cơ).
• Tuyến hàng hải: Nằm gần các tuyến đường biển quốc tế nhộn nhịp, đặc biệt sở hữu kênh đào Pa-na-ma – huyết mạch giao thông đường biển nối liền hai đại dương lớn là Thái Bình Dương và Đại Tây Dương.
        `
    },
    {
        id: "essay_2",
        title: "Câu 2: Trình bày ảnh hưởng của vị trí địa lí và phạm vi lãnh thổ của Mỹ Latinh đến phát triển kinh tế và xã hội của khu vực?",
        content: `
1. Thuận lợi đối với phát triển kinh tế - xã hội:
• Phát triển kinh tế đa ngành: Lãnh thổ rộng lớn, trải dài qua nhiều đới và kiểu khí hậu giúp hình thành các vành đai nông nghiệp phong phú (cây công nghiệp nhiệt đới, cây lương thực, chăn nuôi gia súc lớn), phát triển lâm nghiệp và khai thác khoáng sản.
• Phát triển kinh tế biển: Vùng biển rộng bao bọc ở cả hai phía đông và tây với bờ biển dài tạo điều kiện cực kỳ thuận lợi để phát triển tổng hợp kinh tế biển: xây dựng hệ thống cảng biển nước sâu, vận tải hàng hải quốc tế, khai thác hải sản và du lịch biển - đảo.
• Giao thương quốc tế: Tiếp giáp với Hoa Kỳ và sở hữu kênh đào Pa-na-ma tạo lợi thế chiến lược trong thu hút vốn đầu tư FDI, chuyển giao công nghệ và đẩy mạnh xuất nhập khẩu sang thị trường Bắc Mỹ cũng như toàn cầu.
• Giao thoa văn hóa: Tiếp giáp nhiều biển và đại dương tạo điều kiện sớm tiếp nhận các luồng di cư, hình thành nền văn hóa Mỹ Latinh đặc sắc, đa dạng, thúc đẩy du lịch nhân văn.

2. Khó khăn, thách thức:
• Trở ngại giao thông nội lục: Chiều dài lãnh thổ quá lớn kết hợp với các rào cản tự nhiên hiểm trở (hệ thống núi cao An-đét, bồn địa rừng mưa A-ma-dôn) gây chia cắt địa hình, khó khăn và tốn kém chi phí cho việc xây dựng mạng lưới giao thông đường bộ kết nối giữa các vùng và các quốc gia.
• Thiên tai và biến đổi khí hậu: Nằm trong khu vực thường xuyên chịu tác động của bão nhiệt đới dữ dội (vùng biển Ca-ri-bê), hiện tượng El Nino/La Nina gây lũ lụt, hạn hán thất thường; sườn tây nằm trên Vành đai lửa Thái Bình Dương nên thường xuyên xảy ra động đất và núi lửa.
        `
    },
    {
        id: "essay_3",
        title: "Câu 3: Trình bày những biểu hiện của toàn cầu hóa kinh tế?",
        content: `
Các biểu hiện đặc trưng của toàn cầu hóa kinh tế gồm 5 nội dung chính:
1. Thương mại thế giới phát triển nhanh chóng:
   • Tốc độ tăng trưởng thương mại quốc tế luôn cao hơn tốc độ tăng trưởng kinh tế chung (GDP thế giới).
   • Các rào cản thuế quan và phi thuế quan từng bước được dỡ bỏ; hàng hóa và dịch vụ được tự do lưu thông thuận lợi giữa các quốc gia.
   • Sự hình thành và mở rộng vai trò điều phối thương mại toàn cầu của Tổ chức Thương mại Thế giới (WTO).

2. Tài chính quốc tế phát triển với quy mô bùng nổ:
   • Dòng vốn đầu tư quốc tế (gồm đầu tư trực tiếp nước ngoài - FDI và đầu tư gián tiếp - FPI) luân chuyển tự do, nhanh chóng qua biên giới các quốc gia.
   • Mạng lưới liên kết tài chính, ngân hàng toàn cầu kết nối điện tử 24/7; vai trò giám sát, điều phối tài chính của IMF và WB ngày càng lớn.

3. Các công ty đa quốc gia (MNCs) gia tăng vai trò chi phối:
   • Nắm giữ phần lớn giá trị tài sản, thương mại, vốn đầu tư và sở hữu các công nghệ nguồn hàng đầu thế giới.
   • Trực tiếp thiết lập và chi phối các chuỗi giá trị và mạng lưới sản xuất toàn cầu, thúc đẩy phân công lao động quốc tế chuyên môn hóa sâu.

4. Áp dụng rộng rãi các tiêu chuẩn toàn cầu:
   • Các tiêu chuẩn thống nhất về quản lý chất lượng (ISO), bảo vệ môi trường, trách nhiệm xã hội, truy xuất nguồn gốc sản phẩm ngày càng được chuẩn hóa và bắt buộc áp dụng trong sản xuất, kinh doanh toàn cầu.

5. Gia tăng sự dịch chuyển các nguồn lực sản xuất:
   • Lao động (nhất là lao động chất lượng cao, chuyên gia), nguồn vốn, thông tin dữ liệu và khoa học công nghệ chuyển giao xuyên quốc gia với tốc độ ngày càng nhanh.
        `
    },
    {
        id: "essay_4",
        title: "Câu 4: Hãy cho biết tại sao cần phải bảo vệ hòa bình Thế giới?",
        content: `
Cần phải bảo vệ hòa bình thế giới vì những lí do cấp thiết sau:
1. Hòa bình là nền tảng sống còn để phát triển xã hội:
   • Môi trường hòa bình và ổn định chính trị là điều kiện tiên quyết để các quốc gia tập trung mọi nguồn lực vào tăng trưởng kinh tế, phát triển giáo dục, y tế, an sinh xã hội và nâng cao chất lượng cuộc sống của con người.

2. Ngăn ngừa hậu quả thảm khốc của chiến tranh và xung đột vũ trang:
   • Chiến tranh cướp đi sinh mạng của hàng triệu thường dân vô tội, gây thương tật, li tán gia đình, khủng hoảng người tị nạn.
   • Phá hủy hoàn toàn các công trình hạ tầng kinh tế - xã hội, gây lãng phí khổng lồ của cải vật chất và đẩy nền kinh tế thụt lùi hàng chục năm.
   • Nguy cơ vũ khí hủy diệt hàng loạt (vũ khí hạt nhân, hóa học, sinh học) có thể đe dọa trực tiếp đến sự tồn vong của toàn nhân loại.

3. Điều kiện bắt buộc để hợp tác giải quyết các vấn đề toàn cầu:
   • Thế giới ngày nay đang đối mặt với các nguy cơ an ninh phi truyền thống mang tính toàn cầu như: biến đổi khí hậu, dịch bệnh truyền nhiễm, cạn kiệt tài nguyên, khủng hoảng an ninh lương thực và an ninh năng lượng.
   • Không một quốc gia nào có thể tự giải quyết đơn lẻ các thách thức này; chỉ có hòa bình, tin cậy lẫn nhau mới tạo cơ sở để các nước hợp tác, chia sẻ nguồn lực đối phó.

4. Giảm thiểu chi phí quân sự, hướng nguồn lực vào xóa đói giảm nghèo:
   • Chạy đua vũ trang tiêu tốn hàng nghìn tỉ USD mỗi năm. Bảo vệ hòa bình giúp các nước cắt giảm ngân sách quốc phòng vô nghĩa để chuyển sang đầu tư cho các Mục tiêu Phát triển Bền vững (SDGs) của Liên hợp quốc.
        `
    }
];

// Toàn bộ 52 câu trắc nghiệm ghép lại
const rawAllGeographyQuestions = [
    ...rawGeographyMCQ,
    ...rawGeographyTrueFalse,
    ...rawGeographyShortAnswer
];

// Xuất ra biến toàn cục window
window.GEOGRAPHY_QUESTIONS = rawAllGeographyQuestions;
window.GEOGRAPHY_ESSAY_OUTLINES = rawGeographyEssayOutlines;
