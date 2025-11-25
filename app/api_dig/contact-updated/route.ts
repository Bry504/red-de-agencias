/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ==============================
// Tipos y helpers base
// ==============================
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringField(
  obj: JsonRecord | null | undefined,
  key: string
): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const last9 = digits.slice(-9);
  return last9 || null;
}

function parseDateToISO(raw: string | null): string | null {
  if (!raw) return null;

  let cleaned = raw.replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1');
  cleaned = cleaned.replace(/,/g, '').trim();

  let d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  const match = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (match) {
    const monthName = match[1];
    const day = match[2];
    const year = new Date().getFullYear();
    d = new Date(`${monthName} ${day} ${year}`);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  console.warn('[DIG contact-updated] Fecha inválida:', raw);
  return null;
}

// ==============================
// Supabase
// ==============================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ==============================
// Token
// ==============================
const WEBHOOK_TOKEN =
  process.env.GHL_DIGITAL_WEBHOOK_TOKEN ??
  process.env.GHL_API_KEY ??
  '';

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const rawBody: unknown = await req.json().catch(() => null);
    if (!isRecord(rawBody)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const root = rawBody;

    let contact: JsonRecord = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contact = root['contact'] as JsonRecord;
    } else {
      contact = root;
    }

    let customData: JsonRecord = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as JsonRecord;
    }

    // ======================
    // hl_contact_id obligatorio (pero sin error)
    // ======================
    const hl_contact_id =
      getStringField(customData, 'hl_contact_id') ??
      getStringField(root, 'hl_contact_id') ??
      getStringField(contact, 'id');

    if (!hl_contact_id) {
      console.log("[DIG contact-updated] Sin hl_contact_id → skip silencioso");
      return NextResponse.json({ ok: true, skipped: true });
    }

    // ======================
    // Resolver campos
    // ======================
    const celular = normalizePhone(
      getStringField(customData, 'celular') ??
        getStringField(root, 'celular') ??
        getStringField(contact, 'phone')
    );

    let nombre_completo =
      getStringField(customData, 'nombre_completo') ??
      getStringField(root, 'nombre_completo');

    if (!nombre_completo) {
      const first = getStringField(contact, 'firstName') ?? '';
      const last = getStringField(contact, 'lastName') ?? '';
      nombre_completo = `${first} ${last}`.trim() || null;
    }

    const email =
      getStringField(customData, 'email') ??
      getStringField(root, 'email') ??
      getStringField(contact, 'email');

    const nombre_anuncio =
      getStringField(customData, 'nombre_anuncio') ??
      getStringField(root, 'nombre_anuncio');

    const conjunto_de_anuncios =
      getStringField(customData, 'conjunto_de_anuncios') ??
      getStringField(root, 'conjunto_de_anuncios');

    const nombre_campaña =
      getStringField(customData, 'nombre_campaña') ??
      getStringField(root, 'nombre_campaña');

    const fuente_digital =
      getStringField(customData, 'fuente_digital') ??
      getStringField(root, 'fuente_digital');

    const documento_de_identidad =
      getStringField(customData, 'documento_de_identidad') ??
      getStringField(root, 'documento_de_identidad');

    const proyecto_formulario =
      getStringField(customData, 'proyecto_formulario') ??
      getStringField(root, 'proyecto_formulario');

    const id_registro_cliente =
      getStringField(customData, 'id_registro_cliente') ??
      getStringField(root, 'id_registro_cliente');

    const fecha_de_nacimiento = parseDateToISO(
      getStringField(customData, 'fecha_de_nacimiento') ??
        getStringField(root, 'fecha_de_nacimiento')
    );

    // ======================
    // UPDATE
    // ======================
    const { data, error } = await supabase
      .from('contactos')
      .update({
        nombre_completo,
        celular,
        email,
        nombre_anuncio,
        conjunto_de_anuncios,
        nombre_campaña,
        fuente_digital,
        documento_de_identidad,
        proyecto_formulario,
        id_registro_cliente,
        fecha_de_nacimiento,
        canal: 'DIGITAL',
      })
      .eq('hl_contact_id', hl_contact_id)
      .select('id');

    if (error) {
      console.error('[DIG contact-updated] error:', error);
      return NextResponse.json({ ok: true, skipped: true });
    }

    if (!data || data.length === 0) {
      console.log(
        `[DIG contact-updated] No existe contacto con hl_contact_id=${hl_contact_id} → skip`
      );
      return NextResponse.json({ ok: true, skipped: true });
    }

    console.log('[DIG contact-updated] Update OK:', data);

    return NextResponse.json({ ok: true, updated_ids: data.map(r => r.id) });
  } catch {
    return NextResponse.json({ ok: true, skipped: true });
  }
}