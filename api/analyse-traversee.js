// pages/api/analyse-traversee.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY absente côté serveur" });
  }

  try {
    const body = req.body || {};
    const b = body.boussole || {};

    // Helpers
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    // Reconnaît ⚫ / 🔺 même si encodés (PowerShell/Unicode)
    const sym = s => {
      if (!s || typeof s !== "string") return "—";
      const n = s.normalize("NFKD");
      if (n.includes("⚫") || /\u26AB/.test(n)) return "⚫";
      if (n.includes("🔺") || /\u25B2/.test(n) || /\u1F53A/.test(n)) return "🔺";
      return "—";
    };
    const pick = o => ({ carte: safe(o?.carte), polarite: sym(o?.polarite) });

    // Boussole
    const nord  = pick(b.nord);
    const sud   = pick(b.sud);
    const est   = pick(b.est);
    const ouest = pick(b.ouest);

    if (!nord.carte || !sud.carte || !est.carte || !ouest.carte) {
      return res.status(400).json({ error: "Boussole incomplète" });
    }

    // Pièces
    const piece = {
      emotions:     sym(body?.mutations?.emotionsPiece),
      besoins:      sym(body?.mutations?.besoinsPiece),
      revelations:  sym(body?.mutations?.revelationsPiece),
      actions:      sym(body?.mutations?.actionsPiece),
    };

    // Passerelles (serveur)
    const isPass = (polCarte, polPiece) => (polCarte !== "—" && polPiece !== "—" && polCarte !== polPiece);
    const passFlags = {
      emotions:     isPass(nord.polarite,  piece.emotions),
      besoins:      isPass(sud.polarite,   piece.besoins),
      revelations:  isPass(est.polarite,   piece.revelations),
      actions:      isPass(ouest.polarite, piece.actions),
    };

    const memoireCosmos = safe(body?.memoireCosmos);
    const intention = safe(body?.intention);

    // 1) Appel IA —> ne demande QUE les textes des passerelles (si flag=true) + synthèse, en JSON strict.
    const SYSTEM = `
Tu rends uniquement un JSON valide et minimal, sans texte parasite ni balise de code.
Schéma exact:
{
  "passerelles": {
    "emotions": "string | ''",
    "besoins": "string | ''",
    "revelations": "string | ''",
    "actions": "string | ''"
  },
  "synthese": "string"
}

Guides d'écriture:
- Style Oradia: poétique, ancré, clair, sans ésotérisme obscur.
- "Carte passerelle" = donner une phrase courte de passerelle quand demandé (flag=true), sinon renvoyer "".
- Pas de répétition de symboles ici; ne parle pas des symboles. 
- Ne jamais ajouter de clés JSON non demandées. Pas de trailing commas.
`.trim();

    const USER = JSON.stringify({
      intention,
      cartes: {
        emotions: { nom: nord.carte, polarite: nord.polarite, piece: piece.emotions, passerelle: passFlags.emotions },
        besoins:  { nom: sud.carte,  polarite: sud.polarite,  piece: piece.besoins,  passerelle: passFlags.besoins },
        revelations: { nom: est.carte, polarite: est.polarite, piece: piece.revelations, passerelle: passFlags.revelations },
        actions:  { nom: ouest.carte, polarite: ouest.polarite, piece: piece.actions, passerelle: passFlags.actions },
        memoireCosmos
      }
    });

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER }
        ]
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));

    if (!r.ok) {
      const err = await r.text();
      console.error("[OpenAI ERROR][traversee]", err);
      return res.status(502).json({ error: "Analyse indisponible. Réessaie dans un instant." });
    }

    const data = await r.json();
    let payload;
    try { payload = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
    catch { payload = {}; }

    const P = payload?.passerelles || {};
    const synthese = (payload?.synthese || "").trim();

    // 2) Assemblage côté serveur : symboles et passerelles sont sous notre contrôle.
    const polText = s => s === "⚫" ? "⚫ = énergie féminine" : s === "🔺" ? "🔺 = énergie masculine" : null;
    const fmtLine = (label, nom, pol, passKey) => {
      const parts = [];
      parts.push(`${label} : ${nom}`);
      const ptxt = polText(pol);
      if (ptxt) parts[0] += ` (${ptxt})`;
      const pmsg = (P?.[passKey] || "").trim();
      if (passFlags[passKey] && pmsg) parts.push(`— carte passerelle : ${pmsg}`);
      return parts.join(" ");
    };

    const lignes = [
      fmtLine("Ligne 1 – ÉMOTIONS",     nord.carte,  nord.polarite,  "emotions"),
      fmtLine("Ligne 2 – BESOINS",      sud.carte,   sud.polarite,   "besoins"),
      fmtLine("Ligne 3 – RÉVÉLATIONS",  est.carte,   est.polarite,   "revelations"),
      fmtLine("Ligne 4 – ACTIONS",      ouest.carte, ouest.polarite, "actions"),
    ];

    const texte =
`Votre Tirage de la traversée:
${lignes.join("\n")}
Carte Mémoires Cosmos :
${memoireCosmos}

Synthèse du tirage :
${synthese || "—"}`;

    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    console.error("Erreur serveur [traversee]:", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
