/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ==============================
// Supabase
// ==============================
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ==============================
// Token de seguridad (reusamos el mismo patrón que ya tenías)
// ==============================
const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ??
  process.env.GHL_API_KEY ?? // si quieres usar el pit-... como token
  '';

// ==============================
// Helpers
// ==============================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(
  obj: Record<string, unknown> | null | undefined,
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

function toNumberOrNull(v: string | null): number | null {
  if (v === null) return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
}

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

    console.log('[TRAD contact-created] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD contact-created] Token inválido:',
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
      console.error('[TRAD contact-created] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // HighLevel normalmente manda:
    // { contact: {...}, customData: {...}, ... }
    let contact: Record<string, unknown> = {};
    if ('contact' in root && isRecord(root['contact'])) {
      contact = root['contact'] as Record<string, unknown>;
    } else {
      // fallback: por si el contact viene en la raíz
      contact = root;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    // Logs potentes para ver EXACTAMENTE qué está llegando
    console.log(
      '[TRAD contact-created] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[TRAD contact-created] contact =',
      JSON.stringify(contact, null, 2)
    );
    console.log(
      '[TRAD contact-created] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 3) Resolver campos
    //    (primero buscamos en customData, luego contact, luego root)
    // --------------------------------------------------

    // hl_contact_id
    let hl_contact_id =
      getStringField(customData, 'hl_contact_id') ??
      getStringField(root, 'hl_contact_id') ??
      getStringField(contact, 'id');

    // celular (limpiamos a 9 dígitos peruanos)
    let celularRaw =
      getStringField(customData, 'celular') ??
      getStringField(root, 'celular') ??
      getStringField(contact, 'phone');

    let celular: string | null = null;
    if (celularRaw) {
      const digits = celularRaw.replace(/\D/g, '');
      celular = digits.slice(-9) || null;
    }

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

    const documento_de_identidad =
      getStringField(customData, 'documento_de_identidad') ??
      getStringField(root, 'documento_de_identidad');

    const estado_civil =
      getStringField(customData, 'estado_civil') ??
      getStringField(root, 'estado_civil');

    const distrito_de_residencia =
      getStringField(customData, 'distrito_de_residencia') ??
      getStringField(root, 'distrito_de_residencia');

    const profesion =
      getStringField(customData, 'profesion') ??
      getStringField(root, 'profesion');

    const email =
      getStringField(customData, 'email') ??
      getStringField(root, 'email') ??
      getStringField(contact, 'email');

    const origen =
      getStringField(customData, 'origen') ??
      getStringField(root, 'origen');

    const fecha_de_nacimiento =
      getStringField(customData, 'fecha_de_nacimiento') ??
      getStringField(root, 'fecha_de_nacimiento');

    const latitudStr =
      getStringField(customData, 'latitud') ??
      getStringField(root, 'latitud');
    const longitudStr =
      getStringField(customData, 'longitud') ??
      getStringField(root, 'longitud');

    const latitud = toNumberOrNull(latitudStr);
    const longitud = toNumberOrNull(longitudStr);

    // Log de lo que vamos a insertar
    console.log('[TRAD contact-created] Campos mapeados:', {
      nombre_completo,
      celular,
      documento_de_identidad,
      estado_civil,
      distrito_de_residencia,
      profesion,
      email,
      origen,
      fecha_de_nacimiento,
      hl_contact_id,
      latitud,
      longitud
    });

    // --------------------------------------------------
    // 4) Validación mínima REAl
    // --------------------------------------------------
    if (!celular && !hl_contact_id) {
      console.warn(
        '[TRAD contact-created] Sin celular ni hl_contact_id. No se inserta.'
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            'Se requiere al menos celular o hl_contact_id para registrar el contacto.'
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 5) Insert en Supabase
    // --------------------------------------------------
    const { data, error } = await supabase
      .from('contactos')
      .insert([
        {
          nombre_completo,
          celular,
          documento_de_identidad,
          estado_civil,
          distrito_de_residencia,
          profesion,
          email,
          origen,
          fecha_de_nacimiento,
          hl_contact_id,
          latitud,
          longitud,
          canal: 'TRADICIONAL'
        }
      ])
      .select('id')
      .single();

    if (error) {
      console.error('[TRAD contact-created] Supabase insert error:', error);
      return NextResponse.json(
        { ok: false, error: 'No se pudo registrar el contacto en Supabase.' },
        { status: 500 }
      );
    }

    console.log('[TRAD contact-created] Insert OK, id =', data.id);

    return NextResponse.json(
      { ok: true, id: data.id },
      { status: 201 }
    );
  } catch (err) {
    console.error('[TRAD contact-created] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'Error interno en el endpoint.' },
      { status: 500 }
    );
  }
}