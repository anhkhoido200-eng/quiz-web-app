/**
 * physics_questions.js - Đề cương ôn tập trắc nghiệm Vật Lí 11 - Giữa Kì 1
 * Trọn bộ 43 câu hỏi chuẩn đề cương:
 * - PHẦN I: 31 câu trắc nghiệm nhiều phương án lựa chọn (A, B, C, D)
 * - PHẦN II: 3 câu trắc nghiệm Đúng - Sai (12 mệnh đề a, b, c, d)
 * - PHẦN III: 9 câu trả lời ngắn (Điền số / kết quả)
 */

const rawPhysicsMCQ = [
    {
        id: 1,
        category: "Dao động cơ",
        question: "Khoảng thời gian để vật thực hiện được một dao động toàn phần gọi là",
        options: ["tần số.", "chu kì.", "biên độ.", "tần số góc."],
        answer: 1,
        explanation: "Chu kì dao động (kí hiệu T, đơn vị giây s) là khoảng thời gian để vật thực hiện được một dao động toàn phần."
    },
    {
        id: 2,
        category: "Dao động cơ",
        question: "Trong dao động điều hòa thì nhóm đại lượng nào sau đây không thay đổi theo thời gian?",
        options: ["Li độ và thời gian.", "Biên độ và tần số góc.", "Li độ và pha ban đầu.", "Tần số và pha dao động."],
        answer: 1,
        explanation: "Trong dao động điều hòa, biên độ A, tần số góc ω, chu kì T và tần số f là các đại lượng hằng số không đổi theo thời gian."
    },
    {
        id: 3,
        category: "Dao động cơ",
        question: "Dao động tự do là dao động mà chu kì",
        options: [
            "không phụ thuộc vào các đặc tính của hệ.",
            "chỉ phụ thuộc vào các đặc tính của hệ không phụ thuộc vào các yếu tố bên ngoài.",
            "phụ thuộc vào các đặc tính của hệ và các yếu tố bên ngoài.",
            "không phụ thuộc vào các yếu tố bên ngoài."
        ],
        answer: 1,
        explanation: "Dao động tự do là dao động mà chu kì chỉ phụ thuộc vào các đặc tính của hệ, không phụ thuộc vào các yếu tố bên ngoài."
    },
    {
        id: 4,
        category: "Dao động cơ",
        question: "Chuyển động nào sau đây không phải là dao động cơ học?",
        options: [
            "Chuyển động đung đưa của con lắc của đồng hồ.",
            "Chuyển động đung đưa của lá cây.",
            "Chuyển động nhấp nhô của phao trên mặt nước.",
            "Chuyển động của ôtô trên đường."
        ],
        answer: 3,
        explanation: "Dao động cơ học là chuyển động có giới hạn trong không gian, lặp đi lặp lại nhiều lần quanh một vị trí cân bằng. Chuyển động của ôtô trên đường là chuyển động tịnh tiến dời chỗ."
    },
    {
        id: 5,
        category: "Dao động cơ",
        question: "Pít-tông của một động cơ đốt trong dao động trên một đoạn thẳng dài 16 cm và làm cho khuỷu của động cơ quay đều. Biên độ dao động của một điểm trên mặt pít-tông bằng",
        options: ["16 cm.", "8 cm.", "4 cm.", "32 cm."],
        answer: 1,
        explanation: "Đoạn thẳng mà vật dao động qua lại chính là chiều dài quỹ đạo L = 16 cm. Biên độ dao động A = L / 2 = 16 / 2 = 8 cm."
    },
    {
        id: 6,
        category: "Dao động cơ",
        question: "Cho hai dao động điều hòa cùng tần số có pha ban đầu lần lượt φ₁ và φ₂, độ lệch pha của hai dao động này là",
        options: ["Δφ = φ₂ - φ₁.", "Δφ = |φ₂ - φ₁|.", "Δφ = φ₁ · φ₂.", "Δφ = φ₂ / φ₁."],
        answer: 1,
        explanation: "Độ lệch pha giữa hai dao động cùng tần số được tính bằng công thức: Δφ = |φ₂ - φ₁|."
    },
    {
        id: 7,
        category: "Dao động cơ",
        question: "Một vật dao động điều hòa trên trục Ox có đồ thị li độ theo thời gian với đỉnh cao nhất đạt 2,0 cm. Biên độ của vật dao động bằng",
        options: ["1,0 cm.", "2,0 cm.", "4,0 cm.", "3,0 cm."],
        answer: 1,
        explanation: "Biên độ A là giá trị cực đại của li độ x: A = x_max = 2,0 cm."
    },
    {
        id: 8,
        category: "Dao động cơ",
        question: "Một chất điểm dao động điều hòa, gia tốc a và li độ x của chất điểm liên hệ với nhau theo hệ thức a = -16π²x (cm/s²). Chu kỳ của dao động bằng",
        options: ["3 s.", "0,5 s.", "2 s.", "0,25 s."],
        answer: 1,
        explanation: "Ta có a = -ω²x => ω² = 16π² => ω = 4π rad/s. Chu kì T = 2π / ω = 2π / (4π) = 0,5 s."
    },
    {
        id: 9,
        category: "Năng lượng dao động",
        question: "Câu 9a: Một con lắc lò xo có khối lượng vật nhỏ là m dao động điều hòa theo phương ngang với phương trình x = A·cos(ωt). Mốc tính thế năng ở vị trí cân bằng. Cơ năng của con lắc là",
        options: ["W = mωA².", "W = ½ mωA².", "W = mω²A².", "W = ½ mω²A²."],
        answer: 3,
        explanation: "Cơ năng của con lắc lò xo dao động điều hòa: W = ½ kA² = ½ mω²A²."
    },
    {
        id: 10,
        category: "Dao động cơ",
        question: "Câu 9b: Vật có đồ thị li độ dao động có biên độ A = 2 cm và chu kì T = 0,4 s. Ở thời điểm t = 0,2 s, vật có tốc độ dao động là",
        options: ["5π cm/s.", "-5π cm/s.", "10π cm/s.", "-10π cm/s."],
        answer: 2,
        explanation: "Tần số góc ω = 2π / T = 2π / 0,4 = 5π rad/s. Tốc độ dao động cực đại v_max = ωA = 5π · 2 = 10π cm/s."
    },
    {
        id: 11,
        category: "Dao động cơ",
        question: "Câu 10: Một vật dao động điều hòa theo phương trình x = A·cos(ωt + φ). Gọi v và a là vận tốc và gia tốc của vật. Hệ thức đúng là",
        options: [
            "v²/ω⁴ + a²/ω² = A².",
            "v²/ω² + a²/ω² = A².",
            "v²/ω² + a²/ω⁴ = A².",
            "ω²/v² + a²/ω⁴ = A²."
        ],
        answer: 2,
        explanation: "Hệ thức độc lập thời gian giữa vận tốc v và gia tốc a: (v/ω)² + (a/ω²)² = A² <=> v²/ω² + a²/ω⁴ = A²."
    },
    {
        id: 12,
        category: "Dao động cơ",
        question: "Câu 11: Một vật dao động điều hòa có gia tốc biến đổi theo phương trình a = -250·cos(5πt) cm/s². Lấy π² = 10. Gia tốc cực đại của vật có độ lớn là",
        options: ["25 cm/s².", "0,1π m/s².", "250 cm/s².", "10 cm/s²."],
        answer: 2,
        explanation: "Phương trình gia tốc a = -a_max · cos(ωt) => Độ lớn gia tốc cực đại a_max = 250 cm/s²."
    },
    {
        id: 13,
        category: "Dao động tắt dần - Cưỡng bức",
        question: "Câu 12: Khi nói về dao động tắt dần của một vật, phát biểu nào sau đây đúng?",
        options: [
            "Li độ của vật luôn giảm dần theo thời gian.",
            "Gia tốc của vật luôn giảm dần theo thời gian.",
            "Vận tốc của vật luôn giảm dần theo thời gian.",
            "Biên độ dao động giảm dần theo thời gian."
        ],
        answer: 3,
        explanation: "Dao động tắt dần là dao động có biên độ và cơ năng giảm dần theo thời gian do ma sát và lực cản môi trường."
    },
    {
        id: 14,
        category: "Dao động tắt dần - Cưỡng bức",
        question: "Câu 13: Khi nói về dao động cưỡng bức, phát biểu nào sau đây sai?",
        options: [
            "Biên độ của dao động cưỡng bức phụ thuộc vào biên độ của lực cưỡng bức.",
            "Biên độ của dao động cưỡng bức phụ thuộc vào tần số của lực cưỡng bức.",
            "Dao động cưỡng bức có tần số luôn bằng tần số của lực cưỡng bức.",
            "Dao động cưỡng bức có tần số luôn bằng tần số riêng của hệ dao động."
        ],
        answer: 3,
        explanation: "Phát biểu D sai vì dao động cưỡng bức có tần số luôn bằng tần số của lực cưỡng bức f = f_cb, chỉ khi có cộng hưởng thì f_cb mới bằng f₀."
    },
    {
        id: 15,
        category: "Dao động tắt dần - Cưỡng bức",
        question: "Câu 14: Một hệ dao động cơ đang thực hiện dao động cưỡng bức. Hiện tượng cộng hưởng xảy ra khi",
        options: [
            "tần số của lực cưỡng bức bằng tần số dao động riêng của hệ.",
            "tần số của lực cưỡng bức nhỏ hơn tần số dao động riêng của hệ.",
            "tần số của lực cưỡng bức lớn hơn tần số dao động riêng của hệ.",
            "có thêm một lực cưỡng bức tác dụng vào hệ."
        ],
        answer: 0,
        explanation: "Hiện tượng cộng hưởng xảy ra khi tần số của lực cưỡng bức bằng tần số dao động riêng của hệ (f = f₀), làm biên độ dao động đạt giá trị cực đại."
    },
    {
        id: 16,
        category: "Dao động cơ",
        question: "Câu 15: Một vật dao động điều hoà, mỗi chu kỳ dao động vật đi qua vị trí cân bằng",
        options: ["một lần.", "bốn lần.", "ba lần.", "hai lần."],
        answer: 3,
        explanation: "Trong 1 chu kì dao động toàn phần, vật chuyển động qua vị trí cân bằng đúng 2 lần (1 lần theo chiều dương và 1 lần theo chiều âm)."
    },
    {
        id: 17,
        category: "Dao động cơ",
        question: "Câu 16: Một vật dao động điều hòa theo phương trình x = 6·cos(4πt) (cm). Biên độ dao động của vật là",
        options: ["A = 4 cm.", "A = 6 cm.", "A = -6 cm.", "A = 12 m."],
        answer: 1,
        explanation: "Theo phương trình x = A·cos(ωt + φ), biên độ A = 6 cm (biên độ luôn là số dương)."
    },
    {
        id: 18,
        category: "Dao động cơ",
        question: "Câu 17: Phát biểu nào sau đây là sai khi nói về dao động điều hoà?",
        options: [
            "Gia tốc sớm pha π so với li độ.",
            "Vận tốc và gia tốc luôn ngược pha nhau.",
            "Vận tốc luôn trễ pha π/2 so với gia tốc.",
            "Vận tốc luôn sớm pha π/2 so với li độ."
        ],
        answer: 1,
        explanation: "Vận tốc và gia tốc vuông pha với nhau (gia tốc sớm pha π/2 so với vận tốc), không phải ngược pha."
    },
    {
        id: 19,
        category: "Dao động cơ",
        question: "Câu 18: Vật dao động điều hòa khi đi từ biên độ dương về vị trí cân bằng thì",
        options: [
            "li độ vật giảm dần nên gia tốc của vật có giá trị dương.",
            "li độ vật có giá trị dương nên vật chuyển động nhanh dần.",
            "vật đang chuyển động nhanh dần vì vận tốc của vật có giá trị dương.",
            "vật đang chuyển động ngược chiều dương và vận tốc có giá trị âm."
        ],
        answer: 3,
        explanation: "Đi từ biên dương x = +A về VTCB x = 0 là chuyển động ngược chiều dương của trục tọa độ, nên vận tốc v < 0."
    },
    {
        id: 20,
        category: "Con lắc đơn",
        question: "Câu 19: Công thức được dùng để tính tần số dao động của con lắc đơn là",
        options: [
            "f = (1 / 2π) · √(g / ℓ).",
            "f = (1 / 2π) · √(ℓ / g).",
            "f = (1 / π) · √(g / ℓ).",
            "f = (1 / π) · √(ℓ / g)."
        ],
        answer: 0,
        explanation: "Tần số dao động của con lắc đơn: f = 1 / T = (1 / 2π) · √(g / ℓ)."
    },
    {
        id: 21,
        category: "Dao động cơ",
        question: "Câu 20: Dao động tự do là dao động có",
        options: [
            "chu kỳ không phụ thuộc vào yếu tố bên ngoài.",
            "chu kỳ phụ thuộc vào đặc tính của hệ.",
            "chu kỳ không phụ thuộc vào đặc tính của hệ và yếu tố bên ngoài.",
            "chu kỳ phụ thuộc vào đặc tính của hệ và không phụ thuộc vào yếu tố bên ngoài."
        ],
        answer: 3,
        explanation: "Dao động tự do có chu kì chỉ phụ thuộc vào các đặc tính cấu tạo của hệ và hoàn toàn không phụ thuộc vào các yếu tố bên ngoài."
    },
    {
        id: 22,
        category: "Dao động tắt dần - Cưỡng bức",
        question: "Câu 21: Giảm xóc của ôtô là ứng dụng của dao động",
        options: ["tắt dần.", "tự do.", "duy trì.", "cưỡng bức."],
        answer: 0,
        explanation: "Bộ phận giảm xóc ôtô, xe máy ứng dụng dao động tắt dần nhanh bằng cách tăng ma sát cản trở trong ống dầu piston để dập tắt rung lắc."
    },
    {
        id: 23,
        category: "Dao động cơ",
        question: "Câu 22: Một lá thép dao động với chu kì T = 80 ms thì có tần số bằng",
        options: ["10 Hz.", "12,5 Hz.", "15 Hz.", "17,2 Hz."],
        answer: 1,
        explanation: "T = 80 ms = 0,08 s. Tần số f = 1 / T = 1 / 0,08 = 12,5 Hz."
    },
    {
        id: 24,
        category: "Dao động cơ",
        question: "Câu 23: Khi thay đổi cách kích thích ban đầu để vật dao động thì đại lượng nào sau đây thay đổi?",
        options: ["tần số và biên độ.", "pha ban đầu và biên độ.", "biên độ.", "tần số và pha ban đầu."],
        answer: 1,
        explanation: "Tần số và chu kì phụ thuộc vào hệ; cách kích thích ban đầu (kéo lệch bao nhiêu, truyền vận tốc ban đầu) quyết định biên độ A và pha ban đầu φ."
    },
    {
        id: 25,
        category: "Dao động cơ",
        question: "Câu 24: Một chất điểm dao động điều hoà trên quỹ đạo đoạn thẳng MN = 30 cm, biên độ dao động của vật là",
        options: ["A = 30 cm.", "A = 15 cm.", "A = -15 cm.", "A = 7,5 cm."],
        answer: 1,
        explanation: "Chiều dài quỹ đạo L = 2A = 30 cm => Biên độ A = 30 / 2 = 15 cm."
    },
    {
        id: 26,
        category: "Con lắc lò xo",
        question: "Câu 25: Một con lắc lò xo gồm một vật nhỏ khối lượng m và lò xo có độ cứng k. Con lắc dao động điều hòa với tần số góc là",
        options: ["ω = 2π√(m/k).", "ω = 2π√(k/m).", "ω = √(m/k).", "ω = √(k/m)."],
        answer: 3,
        explanation: "Tần số góc của con lắc lò xo: ω = √(k / m)."
    },
    {
        id: 27,
        category: "Sóng cơ",
        question: "Câu 26: Bước sóng là khoảng cách giữa hai điểm",
        options: [
            "gần nhau nhất mà dao động tại hai điểm đó cùng pha.",
            "trên cùng một phương truyền sóng mà dao động tại hai điểm đó cùng pha.",
            "trên cùng một phương truyền sóng mà dao động tại hai điểm đó ngược pha.",
            "gần nhau nhất trên cùng một phương truyền sóng mà dao động tại hai điểm đó cùng pha."
        ],
        answer: 3,
        explanation: "Định nghĩa: Bước sóng λ là khoảng cách giữa hai điểm gần nhau nhất trên cùng một phương truyền sóng dao động cùng pha."
    },
    {
        id: 28,
        category: "Sóng cơ",
        question: "Câu 27: Một sóng cơ có tần số f, truyền trên dây đàn hồi với tốc độ truyền sóng v và bước sóng λ. Hệ thức đúng là",
        options: ["v = λf.", "v = f / λ.", "v = λ / f.", "v = 2πfλ."],
        answer: 0,
        explanation: "Tốc độ truyền sóng: v = λ / T = λf."
    },
    {
        id: 29,
        category: "Sóng cơ",
        question: "Câu 28: Phát biểu nào sau đây là sai khi nói về quá trình truyền sóng?",
        options: [
            "Quá trình truyền sóng là quá trình truyền dao động trong môi trường đàn hồi.",
            "Quá trình truyền sóng là quá trình truyền năng lượng.",
            "Quá trình truyền sóng là quá trình truyền pha dao động.",
            "Quá trình truyền sóng là quá trình truyền các phần tử vật chất."
        ],
        answer: 3,
        explanation: "Sóng cơ chỉ truyền trạng thái và năng lượng dao động; các phần tử vật chất chỉ dao động tại chỗ quanh vị trí cân bằng, không bị truyền đi."
    },
    {
        id: 30,
        category: "Năng lượng dao động",
        question: "Câu 29: Trong dao động điều hòa của con lắc lò xo, khi động năng (Wđ) và thế năng (Wt) của hệ biến đổi liên tục theo thời gian thì đại lượng nào sau đây của hệ luôn được bảo toàn (nếu bỏ qua mọi ma sát)?",
        options: [
            "Biên độ và vận tốc của vật.",
            "Chỉ riêng động năng của hệ.",
            "Cơ năng toàn phần (W = Wt + Wđ).",
            "Li độ và gia tốc của vật."
        ],
        answer: 2,
        explanation: "Khi bỏ qua ma sát, cơ năng toàn phần W = Wt + Wđ = ½ kA² = hằng số, luôn được bảo toàn."
    },
    {
        id: 31,
        category: "Năng lượng dao động",
        question: "Câu 30: Một vật có khối lượng m = 200 g dao động điều hoà với tần số góc ω = 2π rad/s và biên độ A = 10 cm. Tại thời điểm vật có tốc độ v = 10 cm/s, thế năng (Wt) của vật nhận giá trị nào sau đây (lấy π² = 10)?",
        options: ["0,039 J.", "0,040 J.", "0,380 J.", "0,019 J."],
        answer: 0,
        explanation: "Đổi: m = 0,2 kg; A = 0,1 m; v = 0,1 m/s. Cơ năng W = ½ mω²A² = ½ · 0,2 · (4π²) · 0,01 = 0,04 J. Động năng Wđ = ½ mv² = ½ · 0,2 · 0,01 = 0,001 J. Thế năng Wt = W - Wđ = 0,04 - 0,001 = 0,039 J."
    }
];

const rawPhysicsTrueFalse = [
    {
        id: 32,
        category: "Vật Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 1: Cho các phát biểu sau về dao động cơ học:",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Li độ x là độ dịch chuyển từ vị trí bất kì đến vị trí của vật tại thời điểm t.",
                answer: false,
                explanation: "SAI. Li độ x là độ dịch chuyển tính từ vị trí cân bằng đến vị trí của vật tại thời điểm t."
            },
            {
                key: "b",
                label: "b",
                text: "Biên độ A là độ dịch chuyển cực đại của vật tính từ vị trí cân bằng.",
                answer: true,
                explanation: "ĐÚNG. Biên độ A là khoảng cách cực đại từ vị trí cân bằng đến vị trí biên, A > 0."
            },
            {
                key: "c",
                label: "c",
                text: "Chu kỳ là khoảng thời gian để vật thực hiện một dao động toàn phần, kí hiệu là T và có đơn vị là giây.",
                answer: true,
                explanation: "ĐÚNG. Đây là định nghĩa chuẩn của chu kì dao động T."
            },
            {
                key: "d",
                label: "d",
                text: "Tần số là số dao động mà vật thực hiện được trong một giây, kí hiệu là f có đơn vị là Hz. Tần số là đại lượng tỉ lệ thuận với chu kì.",
                answer: false,
                explanation: "SAI. Tần số f tỉ lệ nghịch với chu kì T theo hệ thức f = 1 / T."
            }
        ]
    },
    {
        id: 33,
        category: "Vật Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 2: Cho đồ thị dao động điều hòa của một vật có li độ cực đại 0,2 m và hoàn thành một chu kì hình sin đầy đủ trong thời gian t = 0,4 s:",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Biên độ của dao động là 20 cm.",
                answer: true,
                explanation: "ĐÚNG. Từ trục li độ, x_max = 0,2 m = 20 cm."
            },
            {
                key: "b",
                label: "b",
                text: "Chu kì, tần số của dao động có giá trị lần lượt là 2,5 s và 0,4 Hz.",
                answer: false,
                explanation: "SAI. Chu kì là T = 0,4 s, tần số f = 1 / 0,4 = 2,5 Hz (bị đề đảo ngược giá trị)."
            },
            {
                key: "c",
                label: "c",
                text: "Ở thời điểm ban đầu t = 0 chất điểm ở vị trí cân bằng và chuyển động theo chiều âm.",
                answer: false,
                explanation: "SAI. Tại t = 0, vật ở vị trí cân bằng và li độ đang tăng lên nửa trên đồ thị (chuyển động theo chiều dương)."
            },
            {
                key: "d",
                label: "d",
                text: "Vật có li độ x = 0 ở những thời điểm là t = 0 s, t = 0,2 s, t = 0,4 s, t = 0,6 s,...",
                answer: true,
                explanation: "ĐÚNG. Cứ sau nửa chu kì T/2 = 0,2 s, vật lại đi qua vị trí cân bằng x = 0."
            }
        ]
    },
    {
        id: 34,
        category: "Vật Lí 11: Đúng - Sai",
        qType: "tf_group",
        question: "Câu 3: Một vật dao động điều hoà có phương trình li độ x = 10·cos(10πt + π/3) (cm):",
        statements: [
            {
                key: "a",
                label: "a",
                text: "Tần số dao động của vật là f = 5 Hz.",
                answer: true,
                explanation: "ĐÚNG. Tần số f = ω / (2π) = 10π / (2π) = 5 Hz."
            },
            {
                key: "b",
                label: "b",
                text: "Vận tốc cực đại của vật là 100 cm/s.",
                answer: false,
                explanation: "SAI. v_max = ωA = 10π · 10 = 100π ≈ 314 cm/s."
            },
            {
                key: "c",
                label: "c",
                text: "Pha dao động của vận tốc là 5π/6 rad.",
                answer: true,
                explanation: "ĐÚNG. Vận tốc sớm pha π/2 so với li độ => φ_v = π/3 + π/2 = 5π/6 rad."
            },
            {
                key: "d",
                label: "d",
                text: "Chiều dài quỹ đạo là 10 cm.",
                answer: false,
                explanation: "SAI. Chiều dài quỹ đạo L = 2A = 2 · 10 = 20 cm."
            }
        ]
    }
];

const rawPhysicsShortAnswer = [
    {
        id: 35,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 1: Một vật dao động với phương trình x = 5·cos(2πt + π/4) (cm) thì có biên độ dao động là bao nhiêu cm?",
        correctValue: "5",
        acceptedValues: ["5", "5cm", "5 cm"],
        explanation: "Từ phương trình x = A·cos(ωt + φ), ta thấy biên độ A = 5 cm."
    },
    {
        id: 36,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 2: Một vật dao động điều hòa dọc theo trục Ox với phương trình x = 4·cos(4πt - π/3) (cm). Chu kì dao động của vật là bao nhiêu giây?",
        correctValue: "0.5",
        acceptedValues: ["0.5", "0,5", "0.5s", "0,5s", "0.5 s"],
        explanation: "Chu kì T = 2π / ω = 2π / (4π) = 0,5 giây."
    },
    {
        id: 37,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 3: Một vật dao động điều hòa trên trục Ox. Từ lúc t = 0 ở vị trí cân bằng, sau thời gian t = 0,2 s vật qua vị trí cân bằng lần tiếp theo. Tần số của dao động là bao nhiêu Hz?",
        correctValue: "2.5",
        acceptedValues: ["2.5", "2,5", "2.5Hz", "2,5Hz"],
        explanation: "Thời gian giữa 2 lần liên tiếp qua VTCB là T/2 = 0,2 s => T = 0,4 s => f = 1 / T = 1 / 0,4 = 2,5 Hz."
    },
    {
        id: 38,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 4: Một chất điểm dao động điều hoà có phương trình li độ: x = 6·cos(4πt + π/6) (cm). Tại thời điểm t = 1 s thì li độ của vật là bao nhiêu cm (viết kết quả đến một chữ số sau dấu phẩy thập phân)?",
        correctValue: "5.2",
        acceptedValues: ["5.2", "5,2", "5.2cm", "5,2cm"],
        explanation: "Tại t = 1 s: x = 6·cos(4π·1 + π/6) = 6·cos(π/6) = 6 · (√3 / 2) = 3√3 ≈ 5,196 ≈ 5,2 cm."
    },
    {
        id: 39,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 5: Một con lắc lò xo có độ cứng k = 50 N/m. Người ta kéo quả nặng ra khỏi vị trí cân bằng một đoạn 3 cm rồi thả nhẹ. Cơ năng dao động của con lắc là bao nhiêu Jun (viết kết quả đến hai chữ số sau dấu phẩy thập phân)?",
        correctValue: "0.02",
        acceptedValues: ["0.02", "0,02", "0.023", "0.0225", "0,0225"],
        explanation: "Đổi A = 3 cm = 0,03 m. Cơ năng W = ½ kA² = ½ · 50 · (0,03)² = 0,0225 J ≈ 0,02 J."
    },
    {
        id: 40,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 6: Một vật dao động điều hòa, gia tốc và li độ liên hệ theo hệ thức a = -25π²x (cm/s²). Chu kỳ của dao động bằng bao nhiêu giây (viết kết quả đến hai chữ số sau dấu phẩy thập phân)?",
        correctValue: "0.4",
        acceptedValues: ["0.4", "0,4", "0.40", "0,40"],
        explanation: "Ta có a = -ω²x => ω = 5π rad/s => T = 2π / (5π) = 0,4 s."
    },
    {
        id: 41,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 7: Một con ong mật đang bay tại chỗ trong không trung, đập cánh với tần số khoảng 300 Hz. Số dao động mà cánh ong mật thực hiện trong 1 giây là bao nhiêu?",
        correctValue: "300",
        acceptedValues: ["300", "300 lần", "300 dao động"],
        explanation: "Tần số f = 300 Hz chính là số dao động toàn phần mà cánh ong thực hiện trong 1 giây."
    },
    {
        id: 42,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 8: Một người xách một xô nước đi trên đường mỗi bước đi dài 50 cm thì nước trong xô bị sóng sánh mạnh nhất (xảy ra cộng hưởng). Vận tốc đi của người đó là 2,5 km/h. Chu kì dao động riêng của nước trong xô là bao nhiêu giây?",
        correctValue: "0.72",
        acceptedValues: ["0.72", "0,72", "0.72s", "0,72s"],
        explanation: "Đổi v = 2,5 km/h = 2,5 / 3,6 = 25/36 m/s. Bước đi s = 50 cm = 0,5 m. Chu kì riêng T = s / v = 0,5 / (25/36) = 0,72 s."
    },
    {
        id: 43,
        category: "Vật Lí 11: Trả lời ngắn",
        qType: "short_answer",
        question: "Câu 9: Một con lắc lò xo đang dao động tắt dần, sau ba chu kì đầu tiên biên độ của nó giảm đi 10%. Phần trăm cơ năng còn lại sau khoảng thời gian đó là bao nhiêu %?",
        correctValue: "81",
        acceptedValues: ["81", "81%", "81 %"],
        explanation: "Biên độ còn lại: A' = A - 10%A = 0,9A. Cơ năng tỉ lệ thuận với bình phương biên độ: W' / W = (A' / A)² = (0,9)² = 0,81 = 81%."
    }
];

const PHYSICS_QUESTIONS = [
    ...rawPhysicsMCQ.map(q => ({
        id: q.id,
        qType: 'mcq',
        category: q.category,
        question: q.question,
        options: q.options,
        correct: q.answer,
        isMultiple: false,
        explanation: q.explanation
    })),
    ...rawPhysicsTrueFalse,
    ...rawPhysicsShortAnswer
];

if (typeof window !== 'undefined') {
    window.PHYSICS_QUESTIONS = PHYSICS_QUESTIONS;
}
