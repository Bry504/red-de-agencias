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
// Token de seguridad
// ==============================
const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ??
  process.env.GHL_API_KEY ??
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

// Normaliza fechas tipo "Jul 16th 2001" -> "2001-07-16"
function normalizeDate(input: string | null): string | null {
  if (!input) return null;

  // quitar ordinales: 1st, 2nd, 3rd, 4th...
  const cleaned = input.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  const d = new Date(cleaned);
  if (isNaN(d.getTime())) {
    console.log('[TRAD contact-updated] Fecha inválida recibida:', input);
    return null;
  }

  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
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

    console.log('[TRAD contact-updated] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD contact-updated] Token inválido:',
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
      console.error('[TRAD contact-updated] Body no es objeto:', rawBody);
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

    // Logs para debug (deja estos mientras estés probando)
    console.log(
      '[TRAD contact-updated] root =',
      JSON.stringify(root, null, 2)
    );
    console.log(
      '[TRAD contact-updated] contact =',
      JSON.stringify(contact, null, 2)
    );
    console.log(
      '[TRAD contact-updated] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 3) Resolver campos (igual que en contact-created)
    // --------------------------------------------------

    // hl_contact_id (OBLIGATORIO para actualizar)
    let hl_contact_id =
      getStringField(customData, 'hl_contact_id') ??
      getStringField(root, 'hl_contact_id') ??
      getStringField(contact, 'id');

    if (!hl_contact_id) {
      console.warn(
        '[TRAD contact-updated] Sin hl_contact_id. No se puede actualizar.'
      );
      return NextResponse.json(
        { ok: false, error: 'Missing hl_contact_id' },
        { status: 400 }
      );
    }

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

    const fechaRaw =
      getStringField(customData, 'fecha_de_nacimiento') ??
      getStringField(root, 'fecha_de_nacimiento');

    const fecha_de_nacimiento = normalizeDate(fechaRaw);

    // Log de los campos que vamos a usar para el UPDATE
    console.log('[TRAD contact-updated] Campos mapeados:', {
      nombre_completo,
      celular,
      documento_de_identidad,
      estado_civil,
      distrito_de_residencia,
      profesion,
      email,
      origen,
      fechaRaw,
      fecha_de_nacimiento,
      hl_contact_id
    });

    // --------------------------------------------------
    // 4) Ver si existe el contacto en Supabase
    // --------------------------------------------------
    const { data: existing, error: fetchError } = await supabase
      .from('contactos')
      .select('id')
      .eq('hl_contact_id', hl_contact_id)
      .maybeSingle();

    if (fetchError) {
      console.error(
        '[TRAD contact-updated] Error buscando contacto por hl_contact_id:',
        fetchError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_fetch_error' },
        { status: 500 }
      );
    }

    if (!existing) {
      console.warn(
        '[TRAD contact-updated] No se encontró contacto con hl_contact_id =',
        hl_contact_id,
        '. No se actualiza nada.'
      );
      return NextResponse.json(
        { ok: true, updated: false, reason: 'not_found' },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 5) Armar payload de actualización
    //     (sobre-escribe los campos con lo que venga del webhook)
    // --------------------------------------------------
    const updatePayload: Record<string, unknown> = {
      nombre_completo,
      celular,
      documento_de_identidad,
      estado_civil,
      distrito_de_residencia,
      profesion,
      email,
      origen,
      fecha_de_nacimiento
      // hl_contact_id NO se toca (es la llave)
      // canal tampoco se toca
    };

    console.log(
      '[TRAD contact-updated] updatePayload =',
      JSON.stringify(updatePayload, null, 2)
    );

    const { data: updatedRow, error: updateError } = await supabase
      .from('contactos')
      .update(updatePayload)
      .eq('hl_contact_id', hl_contact_id)
      .select('id')
      .single();

    if (updateError) {
      console.error(
        '[TRAD contact-updated] Error actualizando contacto:',
        updateError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_update_error' },
        { status: 500 }
      );
    }

    console.log(
      '[TRAD contact-updated] Update OK, id =',
      updatedRow?.id ?? null
    );

    return NextResponse.json(
      { ok: true, updated: true, id: updatedRow?.id ?? null },
      { status: 200 }
    );
  } catch (err) {
    console.error('[TRAD contact-updated] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}