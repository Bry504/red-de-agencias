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

interface OwnerChangedClean {
  hl_opportunity_id: string | null;
  propietario_ghl_id: string | null;
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

    console.log('[TRAD owner-changed] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD owner-changed] Token inválido:',
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
    // 2) Leer body
    // --------------------------------------------------
    const rawBody: unknown = await req.json().catch(() => null);

    if (!isRecord(rawBody)) {
      console.error('[TRAD owner-changed] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // --------------------------------------------------
    // 3) Extraer customData si existe
    // --------------------------------------------------
    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    console.log('[TRAD owner-changed] root =', JSON.stringify(root, null, 2));
    console.log(
      '[TRAD owner-changed] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 4) Limpiar campos que nos interesan
    // --------------------------------------------------
    const cleaned: OwnerChangedClean = {
      hl_opportunity_id:
        getStringField(customData, 'oportunidad') ??
        getStringField(root, 'oportunidad'),
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
    };

    console.log('[TRAD owner-changed] Campos limpios:', cleaned);

    if (!cleaned.hl_opportunity_id) {
      console.warn('[TRAD owner-changed] Falta hl_opportunity_id (oportunidad)');
      return NextResponse.json(
        { ok: false, error: 'Missing hl_opportunity_id' },
        { status: 400 }
      );
    }

    if (!cleaned.propietario_ghl_id) {
      console.warn('[TRAD owner-changed] Falta propietario (ghl_id)');
      return NextResponse.json(
        { ok: false, error: 'Missing propietario_ghl_id' },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 5) Buscar oportunidad por hl_opportunity_id
    // --------------------------------------------------
    const { data: oppRow, error: oppError } = await supabase
      .from('oportunidades')
      .select('id, propietario_id')
      .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
      .maybeSingle();

    if (oppError) {
      console.error(
        '[TRAD owner-changed] Error buscando oportunidad por hl_opportunity_id:',
        oppError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: oppError.message },
        { status: 500 }
      );
    }

    if (!oppRow) {
      console.warn(
        '[TRAD owner-changed] No se encontró oportunidad con hl_opportunity_id =',
        cleaned.hl_opportunity_id
      );
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'opportunity_not_found' },
        { status: 200 }
      );
    }

    const oportunidadId = oppRow.id as string;
    const propietarioAnteriorId = (oppRow.propietario_id ?? null) as string | null;

    // --------------------------------------------------
    // 6) Resolver nuevo propietario (usuarios.ghl_id -> usuarios.id)
// --------------------------------------------------
    const { data: nuevoUsuarioRow, error: nuevoUsuarioError } = await supabase
      .from('usuarios')
      .select('id')
      .eq('ghl_id', cleaned.propietario_ghl_id)
      .maybeSingle();

    if (nuevoUsuarioError) {
      console.error(
        '[TRAD owner-changed] Error buscando nuevo propietario en usuarios:',
        nuevoUsuarioError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: nuevoUsuarioError.message },
        { status: 500 }
      );
    }

    if (!nuevoUsuarioRow?.id) {
      console.warn(
        '[TRAD owner-changed] No se encontró usuario con ghl_id =',
        cleaned.propietario_ghl_id
      );
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'new_owner_not_found' },
        { status: 200 }
      );
    }

    const propietarioActualId = nuevoUsuarioRow.id as string;

    // --------------------------------------------------
    // 7) Verificar si realmente hubo cambio de dueño
    // --------------------------------------------------
    if (propietarioAnteriorId && propietarioAnteriorId === propietarioActualId) {
      console.log(
        '[TRAD owner-changed] Mismo propietario. No se registra reasignación.'
      );
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'same_owner' },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 8) Insertar en reasignaciones
    // --------------------------------------------------
    const nowIso = new Date().toISOString();

    const insertPayload: Record<string, unknown> = {
      oportunidad: oportunidadId,
      propietario_anterior: propietarioAnteriorId,
      propietario_actual: propietarioActualId,
      changed_at: nowIso, // si tienes esta columna; si no, quítala
    };

    console.log(
      '[TRAD owner-changed] insertPayload reasignaciones =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('reasignaciones')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[TRAD owner-changed] Error insertando en reasignaciones:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[TRAD owner-changed] Reasignación registrada, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        reasignacion_id: inserted?.id ?? null,
        oportunidad: oportunidadId,
        propietario_anterior: propietarioAnteriorId,
        propietario_actual: propietarioActualId,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[TRAD owner-changed] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}