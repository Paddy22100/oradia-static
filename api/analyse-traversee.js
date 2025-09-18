// API d'analyse Oradia (Vercel Serverless Function)
// URL finale: https://api.oradia.fr/api/analyse-traversee

export default async function handler(req, res) {
  // CORS: autorise UNIQUEMENT ton domaine front
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const body = req.body || {};
    const b = body.boussole || {};

    // Validation simple
    const ok =
      b && b.nord && b.sud && b.est && b.ouest &&
      b.nord.carte && b.sud.carte && b.est.carte && b.ouest.carte;

    if (!ok) {
      return res.status(400).json({ error: "Boussole incomplète" });
    }

    // Prompt "système" = style Oradia
    const system = `
Tu es l'analyste officiel d'Oradia. Style clair, incarné, poétique sans ésotérisme.
Structure EXACTE (obligatoire):
1) NORD — (3–5 phrases)
2) SUD —  (3–5 phrases)
3) EST —  (3–5 phrases)
4) OUEST —(3–5 phrases)
5) SYNTHÈSE — (5–8 phrases, relie les 4 axes)
6) MANTRA — (1 phrase affirmative)
7) QUESTION D’INTROSPECTION — (1 question ouverte, concrète)
Interdits: listes à puces dans 1–5, conseils médicaux/financiers. Langue: français.
`.trim();

    // Prompt "user" = données du tirage
    const user = `
Intention: ${body.intention || "—"}

Boussole:
- NORD: ${b.nord.carte} (pol=${b.nord.polarite || "—"}) | "${b.nord.citation || ""}"
- SUD : ${b.sud.carte}  (pol=${b.sud.polarite  || "—"}) | "${b.sud.citation  || ""}"
- EST : ${b.est.carte}  (pol=${b.est.polarite  || "—"}) | "${b.est.citation  || ""}"
- OUEST: ${b.ouest.carte}(pol=${b.ouest.polarite|| "—"}) | "${b.ouest.citation|| ""}"

Mutations: ${JSON.stringify(body.mutations || [])}
`.trim();

    // Appel modèle (OpenAI Chat Completions)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: `IA: ${err}` });
    }

    const data = await r.json();
    const texte = (data.choices?.[0]?.message?.content || "").trim();

    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
