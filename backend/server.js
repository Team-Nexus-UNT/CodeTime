const OpenAI = require("openai");

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

// middleware
app.use(cors());
app.use(express.json());

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

// test route
app.get("/", (req, res) => {
  res.send("CodeTime backend is running ✅");
});

// LLM route (we’ll improve this later)
app.post("/api/llm", async (req, res) => {
    try {
      const { question, mode, context } = req.body;
  
      console.log("Received:", question);
      console.log("Context length:", context?.length);
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: context,   // ✅ use messages from extension
      });
  
      res.json({
        text: response.choices[0].message.content
      });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "LLM request failed" });
    }
  });

// start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});