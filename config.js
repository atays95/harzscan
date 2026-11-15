// ============================================================
//  HarzScan – Einstellungen
//  Solange supabaseUrl leer ist, läuft die App im DEMO-MODUS:
//  Fotos bleiben auf dem Handy und werden nicht hochgeladen.
//  Die Werte findest du in Supabase unter
//  Project Settings → API (bzw. "API Keys").
//  Der "anon"/"publishable" Key darf öffentlich sein – die
//  Sicherheitsregeln aus setup.sql schützen die Daten.
// ============================================================
window.HARZSCAN_CONFIG = {
  supabaseUrl: "",          // z. B. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",      // z. B. "sb_publishable_..." oder "eyJhbGciOi..."
  bucket: "harzscan",       // Name des Speicher-Buckets (wie in setup.sql)
  projectName: "Masterarbeit Harzfleck-Erkennung",
  contact: ""               // z. B. "Sinan Atay, Hochschule XY" – erscheint im Datenschutzhinweis
};
