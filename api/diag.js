// Force Node.js (sinon Edge par défaut possible)
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    runtime: "node",
    hasKey: !!process.env.OPENAI_API_KEY,
    openaiKeyPrefix: process.env.OPENAI_API_KEY
      ? process.env.OPENAI_API_KEY.slice(0, 8) + "..."
      : null,
    keys: Object.keys(process.env).filter(k => k.includes("OPEN")),
  });
}
