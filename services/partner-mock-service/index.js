const express = require('express');
const app = express();
app.use(express.json());

// Mock API 1: Lấy danh sách câu hỏi
app.get('/api/v1/partner/questions', (req, res) => {
    res.json({
        object: "list",
        data: [
            {
                question_id: "sat_m_98123",
                section: "MATH",
                difficulty: "HARD",
                prompt_html: "<p>If f(x) = 3^(x-1) + 2, what is f(3)?</p>",
                options: [
                    { key: "A", text: "11" },
                    { key: "B", text: "14" },
                    { key: "C", text: "29" }
                ],
                correct_answer: "A",
                explanation_html: "<p>Substitute x = 3: f(3) = 3^2 + 2 = 9 + 2 = 11.</p>"
            }
        ],
        has_more: false
    });
});

// Mock API 2: Chấm điểm bài làm
app.post('/api/v1/partner/assessments/evaluate', (req, res) => {
    const { session_id, responses } = req.body;
    res.json({
        evaluation_id: "eval_77319",
        score_delta: 10,
        correct_count: responses ? responses.length : 0,
        total_evaluated: responses ? responses.length : 0,
        detailed_feedback: [
            { question_id: "sat_m_98123", is_correct: true, correct_answer: "A" }
        ]
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Partner Mock Service running on port ${PORT}`);
});
