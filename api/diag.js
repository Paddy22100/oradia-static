// api/diag.js

// On force l’exécution en runtime Node (sinon Edge par défaut)
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  console.log("Clé côté serveur:", process.env.OPENAI_API_KEY ? "présente" : "absente");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    hasKey: !!process.env.OPENAI_API_KEY,
    envKeys: Object.keys(process.env).filter(k => k.includes("OPEN")),
  });
}
