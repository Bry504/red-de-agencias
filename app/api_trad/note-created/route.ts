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

interface NoteCreatedClean {
  hl_opportunity_id: string | null;
  propietario_ghl_id: string | null;
  contacto_hl_id: string | null;
  pipeline_text: string | null;
  nota: string | null;
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

    console.log('[TRAD note-created] token query =', tokenFromQuery);

    if (!WEBHOOK_TOKEN || !tokenFromQuery || tokenFromQuery !== WEBHOOK_TOKEN) {
      console.warn(
        '[TRAD note-created] Token inválido:',
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
      console.error('[TRAD note-created] Body no es objeto:', rawBody);
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const root = rawBody;

    // --------------------------------------------------
    // 3) Extraer opportunity y customData si existen
    // --------------------------------------------------
    let opportunityObj: Record<string, unknown> = {};
    if ('opportunity' in root && isRecord(root['opportunity'])) {
      opportunityObj = root['opportunity'] as Record<string, unknown>;
    }

    let customData: Record<string, unknown> = {};
    if ('customData' in root && isRecord(root['customData'])) {
      customData = root['customData'] as Record<string, unknown>;
    }

    console.log('[TRAD note-created] root =', JSON.stringify(root, null, 2));
    console.log(
      '[TRAD note-created] opportunity =',
      JSON.stringify(opportunityObj, null, 2)
    );
    console.log(
      '[TRAD note-created] customData =',
      JSON.stringify(customData, null, 2)
    );

    // --------------------------------------------------
    // 4) Resolver hl_opportunity_id
    // --------------------------------------------------
    let hlOpportunityId =
      getStringField(customData, 'hl_opportunity_id') ??
      getStringField(root, 'hl_opportunity_id');

    if (!hlOpportunityId) {
      hlOpportunityId =
        getStringField(opportunityObj, 'id') ??
        getStringField(root, 'opportunity_id');
    }

    // --------------------------------------------------
    // 5) Limpiar campos que nos interesan
    // --------------------------------------------------
    const cleaned: NoteCreatedClean = {
      hl_opportunity_id: hlOpportunityId ?? null,
      propietario_ghl_id:
        getStringField(customData, 'propietario') ??
        getStringField(root, 'propietario'),
      contacto_hl_id:
        getStringField(customData, 'contacto') ??
        getStringField(root, 'contacto'),
      pipeline_text:
        getStringField(customData, 'pipeline') ??
        getStringField(root, 'pipeline') ??
        getStringField(opportunityObj, 'pipeline_name'),
      nota:
        getStringField(customData, 'nota') ??
        getStringField(root, 'nota'),
    };

    console.log('[TRAD note-created] Campos limpios:', cleaned);

    // --------------------------------------------------
    // 6) Resolver propietario (usuarios.ghl_id -> usuarios.id)
    // --------------------------------------------------
    let propietarioId: string | null = null;

    if (cleaned.propietario_ghl_id) {
      const { data: usuarioRow, error: usuarioError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('ghl_id', cleaned.propietario_ghl_id)
        .maybeSingle();

      if (usuarioError) {
        console.error(
          '[TRAD note-created] Error buscando propietario en usuarios:',
          usuarioError
        );
      } else if (usuarioRow?.id) {
        propietarioId = usuarioRow.id as string;
      } else {
        console.warn(
          '[TRAD note-created] No se encontró usuario con ghl_id =',
          cleaned.propietario_ghl_id
        );
      }
    } else {
      console.warn(
        '[TRAD note-created] Payload sin propietario (ghl_id). Se insertará propietario = null.'
      );
    }

    // --------------------------------------------------
    // 7) Resolver contacto (contactos.hl_contact_id -> contactos.id)
    // --------------------------------------------------
    let contactoId: string | null = null;

    if (cleaned.contacto_hl_id) {
      const { data: contactoRow, error: contactoError } = await supabase
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', cleaned.contacto_hl_id)
        .maybeSingle();

      if (contactoError) {
        console.error(
          '[TRAD note-created] Error buscando contacto en contactos:',
          contactoError
        );
      } else if (contactoRow?.id) {
        contactoId = contactoRow.id as string;
      } else {
        console.warn(
          '[TRAD note-created] No se encontró contacto con hl_contact_id =',
          cleaned.contacto_hl_id
        );
      }
    } else {
      console.warn(
        '[TRAD note-created] Payload sin contacto (hl_contact_id). Se insertará contacto = null.'
      );
    }

    // --------------------------------------------------
    // 8) Resolver pipeline desde la tabla oportunidades
    // --------------------------------------------------
    let pipelineFinal: string | null = null;

    if (cleaned.hl_opportunity_id) {
      const { data: oppRow, error: oppError } = await supabase
        .from('oportunidades')
        .select('pipeline')
        .eq('hl_opportunity_id', cleaned.hl_opportunity_id)
        .maybeSingle();

      if (oppError) {
        console.error(
          '[TRAD note-created] Error buscando oportunidad para pipeline:',
          oppError
        );
      } else if (oppRow && typeof oppRow.pipeline === 'string') {
        pipelineFinal = (oppRow.pipeline as string).trim() || null;
      } else {
        console.warn(
          '[TRAD note-created] No se encontró oportunidad o pipeline para hl_opportunity_id =',
          cleaned.hl_opportunity_id
        );
      }
    }

    // Fallback: si no se pudo leer de la tabla, usamos el texto del webhook
    if (!pipelineFinal) {
      pipelineFinal = cleaned.pipeline_text ?? null;
    }

    // --------------------------------------------------
    // 9) Insertar en notas
    // --------------------------------------------------
    const insertPayload: Record<string, unknown> = {
      propietario: propietarioId,
      contacto: contactoId,
      pipeline: pipelineFinal,
      nota: cleaned.nota,
    };

    console.log(
      '[TRAD note-created] insertPayload notas =',
      JSON.stringify(insertPayload, null, 2)
    );

    const { data: inserted, error: insertError } = await supabase
      .from('notas')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error(
        '[TRAD note-created] Error insertando nota:',
        insertError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_error', details: insertError.message },
        { status: 500 }
      );
    }

    console.log(
      '[TRAD note-created] Insert OK en notas, id =',
      inserted?.id ?? null
    );

    return NextResponse.json(
      {
        ok: true,
        nota_id: inserted?.id ?? null,
        propietario: propietarioId,
        contacto: contactoId,
        pipeline: pipelineFinal,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[TRAD note-created] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}