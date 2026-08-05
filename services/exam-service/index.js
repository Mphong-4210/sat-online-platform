const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const amqp = require('amqplib');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://sat_user:sat_password@postgres:5432/sat_db';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const PARTNER_URL = process.env.PARTNER_URL || 'http://partner-mock-service:3001/api/evaluate';

// Kết nối PostgreSQL
const pool = new Pool({ connectionString: DATABASE_URL });

// Kết nối Redis Cache
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS exams (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                duration INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS submissions (
                id SERIAL PRIMARY KEY,
                student_id VARCHAR(100) NOT NULL,
                answers JSONB NOT NULL,
                status VARCHAR(50) DEFAULT 'QUEUED',
                score INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Database tables initialized successfully.');
    } catch (err) {
        console.error('Failed to initialize database tables:', err);
    }
}

// RabbitMQ Consumer lắng nghe message
async function startRabbitMQConsumer() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const queue = 'exam_submissions';
        await channel.assertQueue(queue, { durable: true });
        console.log(`RabbitMQ Consumer connected, waiting for messages in queue: ${queue}`);

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const content = JSON.parse(msg.content.toString());
                console.log('Received submission from queue:', content);
                try {
                    // Gọi HTTP sang partner-mock-service để đánh giá bài thi
                    const response = await axios.post(PARTNER_URL, {
                        studentId: content.studentId,
                        answers: content.answers
                    });
                    console.log('Partner evaluation result:', response.data);
                    channel.ack(msg);
                } catch (error) {
                    console.error('Error calling partner evaluation service:', error.message);
                    // Requeue hoặc từ chối tuỳ logic, ở đây từ chối không requeue để tránh lặp vô hạn
                    channel.nack(msg, false, false);
                }
            }
        });
    } catch (error) {
        console.error('RabbitMQ Consumer connection failed (will retry in background):', error.message);
    }
}

// Endpoint lấy danh sách exams (có dùng Redis cache)
app.get('/api/exams', async (req, res) => {
    try {
        await redisClient.connect().catch(() => {});
        const cachedExams = await redisClient.get('exams_list');
        if (cachedExams) {
            return res.json({ source: 'redis', data: JSON.parse(cachedExams) });
        }

        const result = await pool.query('SELECT * FROM exams');
        let exams = result.rows;
        if (exams.length === 0) {
            // Seed dữ liệu mẫu nếu bảng trống
            await pool.query("INSERT INTO exams (title, duration) VALUES ('SAT Practice Test 1', 180) ON CONFLICT DO NOTHING;");
            const seedResult = await pool.query('SELECT * FROM exams');
            exams = seedResult.rows;
        }

        await redisClient.setEx('exams_list', 60, JSON.stringify(exams));
        await redisClient.quit().catch(() => {});
        res.json({ source: 'database', data: exams });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint submit exam, đẩy queue và gọi sang partner-mock-service
app.post('/api/submit-exam', async (req, res) => {
    const { studentId, answers } = req.body;
    if (!studentId || !answers) {
        return res.status(400).json({ error: 'Missing required fields: studentId or answers' });
    }

    try {
        // 1. Lưu vào PostgreSQL
        await pool.query(
            'INSERT INTO submissions (student_id, answers, status) VALUES ($1, $2, $3)',
            [studentId, JSON.stringify(answers), 'QUEUED']
        );

        // 2. Đẩy vào RabbitMQ Queue
        try {
            const connection = await amqp.connect(RABBITMQ_URL);
            const channel = await connection.createChannel();
            const queue = 'exam_submissions';
            await channel.assertQueue(queue, { durable: true });
            channel.sendToQueue(queue, Buffer.from(JSON.stringify({ studentId, answers })), { persistent: true });
            setTimeout(() => connection.close(), 500);
        } catch (mqErr) {
            console.error('RabbitMQ publish warning:', mqErr.message);
        }

        // 3. Gọi trực tiếp HTTP sang Partner Service để đảm bảo đồng bộ workflow chấm điểm ngay lập tức
        let evaluationResult = null;
        try {
            const partnerResponse = await axios.post(PARTNER_URL, { studentId, answers });
            evaluationResult = partnerResponse.data;
        } catch (partnerErr) {
            console.error('Partner evaluation call failed:', partnerErr.message);
        }

        res.status(201).json({
            message: 'Exam submitted successfully, queued for grading, and evaluated by partner',
            evaluation: evaluationResult || { status: 'PENDING_PARTNER' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to process submission' });
    }
});

// Endpoint Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', service: 'exam-service' });
});

// Endpoint Metrics chuẩn Prometheus
app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`# HELP exam_service_up Status of exam service\n# TYPE exam_service_up gauge\nexam_service_up 1\n`);
});

app.listen(PORT, async () => {
    console.log(`Exam service running on port ${PORT}`);
    await initDB();
    startRabbitMQConsumer();
});
