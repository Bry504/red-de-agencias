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

// Normaliza teléfono a últimos 9 dígitos (Perú)
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const last9 = digits.slice(-9);
  return last9 || null;
}

// Convierte fechas tipo "Nov 11 1995", "Nov 11, 1995", "November 11th 1995", etc. a YYYY-MM-DD
function parseDateToISO(raw: string | null): string | null {
  if (!raw) return null;

  // Quitar sufijos: "st", "nd", "rd", "th"
  let cleaned = raw.replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1');

  // Quitar comas
  cleaned = cleaned.replace(/,/g, '').trim();

  // Intentar parseo directo
  let d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  // Caso: "Nov 11" sin año -> asumimos año actual
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

  console.warn('[DIG contact-updated] Fecha no válida, se envió:', raw);
  return null;
}

// ==============================
// Supabase
// ==============================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan variables de entorno de Supabase');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ==============================
// Token de seguridad
// ==============================
const WEBHOOK_TOKEN =
  process.env.GHL_DIGITAL_WEBHOOK_TOKEN ??
  process.env.GHL_API_KEY ?? // tu pit-...
  '';

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    // --------------------------------------------------
    // 1) Validar token ?token=...
    // --------------------------------------------------
    const url = new URL(req.url);
    const tokenFromQuery = url.searchParams.get('token');

    console.log('[DIG contact-updated] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[DIG contact-updated] Token inválido:',
        tokenFromQuery,
        'esperado:',
        WEBHOOK_TOKEN ? '(definido)' : '(VACÍO)'
      );
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: invalid token' },
        { status: 401 }
      );
    }

    // --------------------------------------------------
    // 2) Leer body bruto
    // --------------------------------------------------
    const rawBody: unknown = await req.json().catch(() => null);

    if (!isRecord(rawBody)) {
      console.error('[DIG contact-updated] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root: JsonRecord = rawBody;

    // HighLevel a veces manda:
    // { contact: {...}, customData: {...}, ... }
    // pero tú también puedes mandar todo en la raíz.
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

    // Logs para depurar si algo falla
    console.log(
      '[DIG contact-updated] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[DIG contact-updated] contact =',
      JSON.stringify(contact, null, 2)
    );
    console.log(
      '[DIG contact-updated] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 3) Resolver campos (orden: customData -> root -> contact)
    // --------------------------------------------------

    // hl_contact_id (OBLIGATORIO para actualizar)
    const hl_contact_id =
      getStringField(customData, 'hl_contact_id') ??
      getStringField(root, 'hl_contact_id') ??
      getStringField(contact, 'id');

    if (!hl_contact_id) {
      console.warn(
        '[DIG contact-updated] No se envió hl_contact_id. No se puede actualizar.'
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            'Se requiere hl_contact_id para actualizar el contacto en Supabase.',
        },
        { status: 400 }
      );
    }

    // celular
    const celular = normalizePhone(
      getStringField(customData, 'celular') ??
        getStringField(root, 'celular') ??
        getStringField(contact, 'phone')
    );

    // nombre_completo
    let nombre_completo =
      getStringField(customData, 'nombre_completo') ??
      getStringField(root, 'nombre_completo');

    if (!nombre_completo) {
      const first = getStringField(contact, 'firstName') ?? '';
      const last = getStringField(contact, 'lastName') ?? '';
      const combined = `${first} ${last}`.trim();
      nombre_completo = combined || null;
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

    // Log de lo que vamos a actualizar
    console.log('[DIG contact-updated] Campos mapeados para UPDATE:', {
      hl_contact_id,
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
    });

    // --------------------------------------------------
    // 4) UPDATE en Supabase por hl_contact_id
    // --------------------------------------------------
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
      console.error('[DIG contact-updated] Supabase update error:', error);
      return NextResponse.json(
        { ok: false, error: 'No se pudo actualizar el contacto en Supabase.' },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      console.warn(
        '[DIG contact-updated] No se encontró contacto con hl_contact_id =',
        hl_contact_id
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            'No existe contacto en Supabase con ese hl_contact_id para actualizar.',
        },
        { status: 404 }
      );
    }

    console.log(
      '[DIG contact-updated] Update OK, ids =',
      data.map((row) => row.id)
    );

    return NextResponse.json(
      { ok: true, updated_ids: data.map((row) => row.id) },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error('[DIG contact-updated] Error inesperado:', err);
    const message =
      err instanceof Error ? err.message : 'Error interno en el endpoint.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}