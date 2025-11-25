/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

// Puedes usar este env o dejar el token fijo si prefieres.
const WEBHOOK_TOKEN =
  process.env.GHL_WEBHOOK_TOKEN ?? 'pit-f995f6e7-c20a-4b1e-8a5e-a18659542bf5';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan variables de entorno de Supabase');
}

const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --------- Helpers de lectura segura ---------

type Dict = Record<string, unknown>;

const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null;

const get = (o: unknown, p: string): unknown => {
  if (!isObj(o)) return undefined;
  return p.split('.').reduce<unknown>((acc, key) => {
    if (!isObj(acc)) return undefined;
    return (acc as Dict)[key];
  }, o);
};

const S = (o: unknown, p: string): string | undefined => {
  const v = get(o, p);
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  return undefined;
};

const N = (o: unknown, p: string): number | undefined => {
  const v = get(o, p);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return undefined;
    const num = Number(t.replace(/,/g, '.'));
    return Number.isNaN(num) ? undefined : num;
  }
  return undefined;
};

// --------- Tipos ---------

interface OportunidadInsert {
  nombre_completo: string | null;
  contacto_id: string | null;
  propietario_id: string; // NOT NULL en BD
  estado: string | null;
  nivel_de_interes: string | null;
  tipo_de_cliente: string | null;
  producto: string | null;
  proyecto: string | null;
  modalidad_de_pago: string | null;
  motivo_de_seguimiento: string | null;
  principales_objeciones: string | null;
  arras: number | null;
  hl_opportunity_id: string | null;
  pipeline: string | null;
}

// --------- Handler ---------

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (token !== WEBHOOK_TOKEN) {
      console.error('[opportunity-created] TOKEN INVALIDO:', token);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const root = (await req.json()) as unknown;
    console.log('[opportunity-created] Payload recibido:', JSON.stringify(root, null, 2));

    // 1) Leemos campos (la mayoría vienen en customData.*)
    const nombreCompleto =
      S(root, 'customData.nombre_completo') ??
      S(root, 'full_name') ??
      S(root, 'opportunity_name');

    const hlContactId =
      S(root, 'customData.hl_contact_id') ?? S(root, 'contact_id');

    const ghlId = S(root, 'customData.ghl_id');

    const estado = S(root, 'customData.estado') ?? S(root, 'status');
    const nivelDeInteres = S(root, 'customData.nivel_de_interes');
    const tipoDeCliente = S(root, 'customData.tipo_de_cliente');
    const producto = S(root, 'customData.producto');
    const proyecto = S(root, 'customData.proyecto') ?? S(root, 'Proyecto');
    const modalidadDePago = S(root, 'customData.modalidad_de_pago');
    const motivoDeSeguimiento = S(root, 'customData.motivo_de_seguimiento');
    const principalesObjeciones = S(root, 'customData.principales_objeciones');
    const hlOpportunityId =
      S(root, 'customData.hl_opportunity_id') ?? S(root, 'id');
    const pipeline =
      S(root, 'customData.pipeline') ??
      S(root, 'pipeline_name') ??
      S(root, 'pipleline_stage');

    // arras puede venir como string o número
    const arrasNumFromN = N(root, 'customData.arras');
    const arras: number | null =
      typeof arrasNumFromN === 'number' ? arrasNumFromN : null;

    console.log('[opportunity-created] Campos base:', {
      nombreCompleto,
      hlContactId,
      ghlId,
      estado,
      nivelDeInteres,
      tipoDeCliente,
      producto,
      proyecto,
      modalidadDePago,
      motivoDeSeguimiento,
      principalesObjeciones,
      hlOpportunityId,
      pipeline,
      arras,
    });

    // 2) Buscamos contacto_id en la tabla contactos por hl_contact_id
    let contactoId: string | null = null;

    if (hlContactId) {
      const { data: contacto, error: contactoError } = await supabaseAdmin
        .from('contactos')
        .select('id')
        .eq('hl_contact_id', hlContactId)
        .maybeSingle();

      if (contactoError && contactoError.code !== 'PGRST116') {
        console.error('[opportunity-created] Error buscando contacto:', contactoError);
      }

      contactoId = contacto?.id ?? null;
      console.log('[opportunity-created] contacto_id resuelto:', contactoId);
    } else {
      console.warn('[opportunity-created] No se envió hl_contact_id en el payload.');
    }

    // 3) Buscamos propietario_id en la tabla usuarios por ghl_id
    if (!ghlId) {
      console.error('[opportunity-created] ERROR: No se envió ghl_id en el payload.');
      return NextResponse.json(
        {
          ok: false,
          error: 'No se envió ghl_id en el payload; no se puede asignar propietario_id.',
        },
        { status: 400 },
      );
    }

    const { data: usuario, error: usuarioError } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .eq('ghl_id', ghlId)
      .maybeSingle();

    if (usuarioError && usuarioError.code !== 'PGRST116') {
      console.error('[opportunity-created] Error buscando usuario:', usuarioError);
      return NextResponse.json(
        { ok: false, error: 'Error buscando usuario en Supabase' },
        { status: 500 },
      );
    }

    if (!usuario?.id) {
      console.error(
        '[opportunity-created] No se encontró usuario con ese ghl_id. No se puede crear oportunidad.',
        { ghlId },
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            'No se encontró usuario con ese ghl_id. La columna propietario_id es NOT NULL, por lo que se aborta la creación.',
        },
        { status: 400 },
      );
    }

    const propietarioId: string = usuario.id;
    console.log('[opportunity-created] propietario_id resuelto:', propietarioId);

    // 4) Armamos el objeto para insertar en oportunidades
    const oportunidad: OportunidadInsert = {
      nombre_completo: nombreCompleto ?? null,
      contacto_id: contactoId, // si no encontró contacto queda null (esta columna es nullable)
      propietario_id: propietarioId, // obligatorio, NOT NULL
      estado: estado ?? null,
      nivel_de_interes: nivelDeInteres ?? null,
      tipo_de_cliente: tipoDeCliente ?? null,
      producto: producto ?? null,
      proyecto: proyecto ?? null,
      modalidad_de_pago: modalidadDePago ?? null,
      motivo_de_seguimiento: motivoDeSeguimiento ?? null,
      principales_objeciones: principalesObjeciones ?? null,
      arras,
      hl_opportunity_id: hlOpportunityId ?? null,
      pipeline: pipeline ?? null,
    };

    console.log('[opportunity-created] Oportunidad a insertar:', oportunidad);

    // 5) Insertamos la oportunidad
    const { data, error } = await supabaseAdmin
      .from('oportunidades')
      .insert(oportunidad)
      .select('id')
      .single();

    if (error) {
      console.error('[opportunity-created] Error insertando oportunidad:', error);
      return NextResponse.json(
        { ok: false, error: 'Error insertando oportunidad' },
        { status: 500 },
      );
    }

    console.log('[opportunity-created] Insert OK, id:', data?.id);

    return NextResponse.json(
      {
        ok: true,
        oportunidad_id: data?.id ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[opportunity-created] Error inesperado:', err);
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 });
  }
}