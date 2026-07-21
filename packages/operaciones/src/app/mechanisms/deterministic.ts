/**
 * Mecanismo determinístico de referencia (Nivel C).
 *
 * Realiza las cuatro operaciones consumiendo únicamente datos autorizados del ECE.
 * Reproducible (mismas entradas → mismo producto), declara reglas, conserva
 * procedencia, se abstiene cuando corresponde, no inventa contenido y no oculta
 * limitaciones. Existe para demostrar que la operación pertenece a la arquitectura
 * y no a un proveedor. No usa IA.
 */
import type { RequestContext } from '@soec/contracts';
import type { ElementoEce } from '@soec/ece';
import type { ContextoMecanismo, MecanismoOperacion } from '../../domain/mechanism';
import type {
  Consideracion,
  Escenario,
  LadoEsclarecido,
  ProductoIntelectual,
  Senal,
  TipoOperacion,
} from '../../domain/product';
import { abstener, baseProducto, construir } from '../product-builder';

function elementos(ctx: ContextoMecanismo): ElementoEce[] {
  return Object.values(ctx.eceState.elementos).sort((a, b) => a.id.localeCompare(b.id));
}
function porTipo(ctx: ContextoMecanismo, tipo: string): ElementoEce[] {
  return elementos(ctx).filter((e) => e.tipo === tipo);
}
function refStr(e: ElementoEce): string[] {
  return e.referencias.map((r) => `${r.modelo}:${r.instanceId}:${r.elementoId ?? '—'}`);
}
function evidenciaDe(els: ElementoEce[]): string[] {
  const s = new Set<string>();
  for (const e of els) for (const ev of e.evidencia) s.add(ev);
  return [...s];
}
function limitacionesDe(els: ElementoEce[]): string[] {
  const s = new Set<string>();
  for (const e of els) for (const l of e.limitaciones) s.add(l);
  return [...s];
}

const NOMBRE = 'determinístico';
const VERSION = '1.0.0';

function tipoLado(elementoTipo: string): LadoEsclarecido['tipo'] {
  if (elementoTipo === 'observacion') return 'observacion';
  if (elementoTipo === 'evidencia') return 'evidencia';
  return 'afirmacion';
}

export class MecanismoDeterministico implements MecanismoOperacion {
  readonly nombre = NOMBRE;
  readonly version = VERSION;
  readonly requiereSalidaDeOrg = false;

  soporta(_op: TipoOperacion): boolean {
    return true;
  }

  async ejecutar(_ctx: RequestContext, contexto: ContextoMecanismo): Promise<ProductoIntelectual> {
    switch (contexto.operacion) {
      case 'esclarecer':
        return this.esclarecer(contexto);
      case 'detectar':
        return this.detectar(contexto);
      case 'proyectar':
        return this.proyectar(contexto);
      case 'orientar':
        return this.orientar(contexto);
    }
  }

  // ── Esclarecer: hacer comprensible lo ya comprendido, sin resolver ──────────
  private esclarecer(ctx: ContextoMecanismo): ProductoIntelectual {
    if (!ctx.objetivoElementoId) {
      return abstener(ctx, this, 'alcance_insuficiente', {
        faltante: ['un elemento objetivo a esclarecer'],
        razones: ['esclarecer requiere señalar qué comprender'],
      });
    }
    const el = ctx.eceState.elementos[ctx.objetivoElementoId];
    if (!el) {
      return abstener(ctx, this, 'ausencia_critica', {
        faltante: [`el elemento '${ctx.objetivoElementoId}' no existe en el ECE`],
        razones: ['no hay comprensión que esclarecer'],
      });
    }
    const lados: LadoEsclarecido[] = el.referencias.map((r) => ({
      referencia: `${r.modelo}:${r.instanceId}:${r.elementoId ?? '—'}`,
      tipo: tipoLado(r.elementoTipo),
      contenido: el.procedencia,
    }));
    const contradiccion = el.tipo === 'contradiccion';
    const base = baseProducto(ctx, this, {
      procedencia: el.procedencia,
      evidencia: el.evidencia,
      incertidumbre: el.incertidumbre,
      limitaciones: el.limitaciones,
      faltante: el.noEvaluable ? ['evidencia indispensable ausente', ...el.limitaciones] : [],
      razones: [
        `el elemento ${el.id} es de tipo ${el.tipo}`,
        `procede de ${el.procedencia}`,
        contradiccion ? 'presenta lados en tensión que no se resuelven' : 'se muestra su estructura y soporte',
      ],
      cuestionesJuicioHumano: contradiccion
        ? ['cuál representación prevalece corresponde al juicio humano']
        : el.noEvaluable
          ? ['si obtener la información faltante corresponde a la persona']
          : [],
    });
    return construir('esclarecer', base, {
      esclarecimiento: {
        elementoTipo: el.tipo,
        lados,
        relacionesExplicitas: [`tipo=${el.tipo}`, `alcance=${el.alcance}`, `origen=${el.origen}`],
        contradiccionSinResolver: contradiccion,
      },
    });
  }

  // ── Detectar: hacer visible lo que no se veía ───────────────────────────────
  private detectar(ctx: ContextoMecanismo): ProductoIntelectual {
    const senales: Senal[] = [];
    for (const e of elementos(ctx)) {
      if (e.tipo === 'coherencia') continue; // una coherencia no es una señal
      const objeto =
        e.tipo === 'contradiccion'
          ? 'tensión: contradicción'
          : e.tipo === 'ausencia'
            ? 'ausencia crítica'
            : e.tipo === 'brecha'
              ? 'brecha empresa↔mundo'
              : 'dependencia';
      senales.push({
        objeto,
        entradas: refStr(e),
        condiciones: e.tipo === 'contradiccion' ? ['evidencia en conflicto'] : e.limitaciones,
        incertidumbre: e.incertidumbre,
        posibleFalsoPositivo: e.evidencia.length === 0,
        noEvaluable: e.noEvaluable,
      });
    }
    const usados = elementos(ctx).filter((e) => e.tipo !== 'coherencia');
    const base = baseProducto(ctx, this, {
      evidencia: evidenciaDe(usados),
      limitaciones: limitacionesDe(usados),
      faltante: porTipo(ctx, 'ausencia').flatMap((e) => e.limitaciones),
      razones:
        senales.length > 0
          ? [`se hallaron ${senales.length} configuración(es) con sustento en el ECE`]
          : ['no se hallaron configuraciones que sustenten una señal'],
      cuestionesJuicioHumano: senales.length > 0 ? ['si una señal amerita atención corresponde a la persona'] : [],
    });
    return construir('detectar', base, { deteccion: { senales } });
  }

  // ── Proyectar: extender la comprensión, sin volverla certeza ────────────────
  private proyectar(ctx: ContextoMecanismo): ProductoIntelectual {
    const brechas = porTipo(ctx, 'brecha');
    const contradicciones = porTipo(ctx, 'contradiccion');
    const dependencias = porTipo(ctx, 'dependencia');
    const coherencias = porTipo(ctx, 'coherencia');
    const horizonte = ctx.horizonte ?? 'no declarado';
    const estadoObservado = coherencias.map((c) => `coherencia ${c.id} (${c.alcance})`);
    const escenarios: Escenario[] = [];

    for (const b of brechas) {
      escenarios.push({
        nombre: `brecha ${b.id}: persiste`,
        supuestos: ['no se actúa sobre la brecha', ...b.limitaciones],
        condiciones: refStr(b),
        resultadoProyectado: 'la distancia empresa↔mundo se mantiene',
        incertidumbre: b.incertidumbre,
      });
      escenarios.push({
        nombre: `brecha ${b.id}: se reduce`,
        supuestos: ['la organización responde a la brecha (supuesto)', ...b.limitaciones],
        condiciones: refStr(b),
        resultadoProyectado: 'la distancia empresa↔mundo disminuye',
        incertidumbre: b.incertidumbre,
      });
    }
    for (const c of contradicciones) {
      escenarios.push({
        nombre: `contradicción ${c.id}: según cada lado`,
        supuestos: ['prevalece un lado u otro (no determinado por el sistema)'],
        condiciones: refStr(c),
        resultadoProyectado: 'el estado futuro depende de cuál representación resulte válida',
        incertidumbre: c.incertidumbre,
      });
    }

    const base = baseProducto(ctx, this, {
      evidencia: evidenciaDe([...brechas, ...contradicciones, ...dependencias]),
      limitaciones: limitacionesDe([...brechas, ...contradicciones]),
      faltante: dependencias.filter((d) => d.estadoSatisfaccion === 'insatisfecha').map((d) => `dependencia ${d.id} insatisfecha`),
      incertidumbre: escenarios.length > 0 ? 'proyección con supuestos declarados' : 'no evaluable',
      razones:
        escenarios.length > 0
          ? [`se derivaron ${escenarios.length} escenario(s) de brechas/contradicciones`]
          : ['sin base suficiente (brechas/contradicciones) para escenarios'],
      cuestionesJuicioHumano: ['ningún escenario es un hecho futuro; la persona pondera'],
    });
    return construir('proyectar', base, {
      proyeccion: {
        horizonte,
        estadoObservado,
        supuestos: escenarios.flatMap((s) => s.supuestos),
        factoresNoObservados: dependencias.filter((d) => d.estadoSatisfaccion === 'insatisfecha').map((d) => d.id),
        escenarios,
      },
    });
  }

  // ── Orientar: poner la comprensión al servicio del juicio humano ────────────
  private orientar(ctx: ContextoMecanismo): ProductoIntelectual {
    const contradicciones = porTipo(ctx, 'contradiccion');
    const ausencias = porTipo(ctx, 'ausencia');
    const brechas = porTipo(ctx, 'brecha');
    const consideraciones: Consideracion[] = [];
    const reservadas: string[] = ['la decisión final corresponde a la persona'];

    for (const c of contradicciones) {
      consideraciones.push({
        asunto: `contradicción ${c.id} sin resolver`,
        razones: [`el ECE registra lados en tensión (${refStr(c).join(' | ')})`],
        consecuenciasConocidas: ['actuar bajo una contradicción no resuelta arrastra su incertidumbre'],
      });
      reservadas.push(`cuál lado de ${c.id} prevalece`);
    }
    for (const a of ausencias) {
      consideraciones.push({
        asunto: `información faltante en ${a.id}`,
        razones: ['un elemento quedó no evaluable por evidencia ausente'],
        consecuenciasConocidas: ['decidir sin la evidencia faltante es un juicio bajo incertidumbre'],
      });
      reservadas.push(`si obtener la evidencia de ${a.id} amerita el esfuerzo`);
    }
    for (const b of brechas) {
      consideraciones.push({
        asunto: `brecha ${b.id}`,
        razones: [`existe distancia empresa↔mundo (${refStr(b).join(' | ')})`],
        consecuenciasConocidas: [],
      });
    }

    if (consideraciones.length === 0) {
      return abstener(ctx, this, 'evidencia_insuficiente', {
        faltante: ['comprensión con tensiones, ausencias o brechas sobre la que orientar'],
        razones: ['no hay materia suficiente para ofrecer consideraciones'],
      });
    }

    const base = baseProducto(ctx, this, {
      evidencia: evidenciaDe([...contradicciones, ...ausencias, ...brechas]),
      limitaciones: limitacionesDe([...contradicciones, ...ausencias, ...brechas]),
      faltante: ausencias.flatMap((a) => a.limitaciones),
      razones: [`se ofrecen ${consideraciones.length} consideración(es) para el juicio humano`],
      cuestionesJuicioHumano: reservadas,
    });
    return construir('orientar', base, {
      orientacion: { asunto: ctx.proposito, consideraciones, cuestionesReservadas: reservadas, noVinculante: true },
    });
  }
}
