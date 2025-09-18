// pages/api/analyse-traversee.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS + UTF-8
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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

    // ---------- IA : JSON détaillé (notes par famille + synthèse riche) ----------
    const SYSTEM = `
Tu rends uniquement un JSON valide (response_format=json_object). Aucune phrase hors JSON.
Schéma EXACT :
{
  "intro": "string (1-2 phrases rappelant ⚫=énergie féminine, 🔺=énergie masculine)",
  "notes": {
    "emotions": "2-3 phrases, concrètes, liées à l'intention",
    "besoins": "2-3 phrases",
    "revelations": "2-3 phrases",
    "actions": "2-3 phrases"
  },
  "passerelles": {
    "emotions": "string | '' (si flag=true fournir 1 phrase de passerelle, sinon '')",
    "besoins": "string | ''",
    "revelations": "string | ''",
    "actions": "string | ''"
  },
  "synthese": "5-8 phrases, claire, incarnée, reliée à l'intention et à la carte Mémoires Cosmos"
}

Règles :
- Style Oradia : poétique, ancré, accessible ; pas d'ésotérisme opaque ni de jargon.
- Ne parle PAS des symboles dans les "passerelles" (juste le sens). Le rappel de symboles est dans "intro".
- Ne pas inventer d'infos manquantes. Pas de clés supplémentaires. Pas de virgules finales.
`.trim();

    const USER = JSON.stringify({
      intention,
      memoireCosmos,
      cartes: {
        emotions: { nom: nord.carte,  polarite: nord.polarite,  piece: piece.emotions,    passerelle: passFlags.emotions },
        besoins:  { nom: sud.carte,   polarite: sud.polarite,   piece: piece.besoins,     passerelle: passFlags.besoins },
        revelations: { nom: est.carte, polarite: est.polarite,  piece: piece.revelations, passerelle: passFlags.revelations },
        actions:  { nom: ouest.carte, polarite: ouest.polarite, piece: piece.actions,     passerelle: passFlags.actions }
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
        max_tokens: 1000,
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

    // ---------- Assemblage côté serveur ----------
    const P = payload || {};
    const intro = (P.intro || "").trim();
    const notes = P.notes || {};
    const passerelles = P.passerelles || {};
    let synthese = (P.synthese || "").trim();

    // Fallback minimal si vide/court
    const ensure = (txt, min = 180, fallback = "—") =>
      (typeof txt === "string" && txt.trim().length >= min) ? txt.trim() : fallback;

    const polText = s => s === "⚫" ? "⚫ = énergie féminine" : s === "🔺" ? "🔺 = énergie masculine" : null;
    const fmtLine = (label, nom, pol, passKey) => {
      const parts = [];
      parts.push(`${label} : ${nom}`);
      const ptxt = polText(pol);
      if (ptxt) parts[0] += ` (${ptxt})`;
      const pmsg = (passerelles?.[passKey] || "").trim();
      if (passFlags[passKey] && pmsg) parts.push(`— carte passerelle : ${pmsg}`);
      return parts.join(" ");
    };

    const lignes = [
      fmtLine("Ligne 1 – ÉMOTIONS",     nord.carte,  nord.polarite,  "emotions"),
      fmtLine("Ligne 2 – BESOINS",      sud.carte,   sud.polarite,   "besoins"),
      fmtLine("Ligne 3 – RÉVÉLATIONS",  est.carte,   est.polarite,   "revelations"),
      fmtLine("Ligne 4 – ACTIONS",      ouest.carte, ouest.polarite, "actions"),
    ];

    const blocNotes =
`Analyse détaillée :
• ÉMOTIONS — ${ensure(notes.emotions || "", 80, "Perspective émotionnelle à préciser.")}
• BESOINS — ${ensure(notes.besoins || "", 80, "Clarifier ce qui doit être nourri/priorisé.")}
• RÉVÉLATIONS — ${ensure(notes.revelations || "", 80, "Ce qui s’éclaire et change de perspective.")}
• ACTIONS — ${ensure(notes.actions || "", 80, "Premiers pas concrets à engager.")}`;

    synthese = ensure(synthese, 220,
      `Votre intention « ${intention} » rencontre ${memoireCosmos || "les Mémoires Cosmos"} : \
intégrez l’élan des cartes et posez une action simple dans les 72h pour matérialiser l’élan.`);

    const introLine = intro ? `${intro}\n\n` : "⚫ = énergie féminine • 🔺 = énergie masculine\n\n";

    const texte =
`${introLine}Votre Tirage de la traversée:
${lignes.join("\n")}
Carte Mémoires Cosmos :
${memoireCosmos}

${blocNotes}

Synthèse du tirage :
${synthese}`;

    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    console.error("Erreur serveur [traversee]:", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
