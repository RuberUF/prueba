import { CAT_POSES, EYE_TONES, WATERCOLOR_THEMES } from '../data/catGeometry';
import { StudioConfig } from '../types/studio';

function toBlenderXZ(x: number, y: number): [number, number, number] {
  // Map 1000x750 2D canvas into Blender 3D XZ plane centered at origin
  const bx = Number(((x - 500) / 100).toFixed(4));
  const bz = Number(((375 - y) / 100).toFixed(4));
  return [bx, 0.0, bz];
}

export function generateBlenderPythonScript(config: StudioConfig): string {
  const pose = CAT_POSES[config.pose];
  const theme = WATERCOLOR_THEMES[config.watercolorTheme];
  const eyeTone = EYE_TONES[config.eyeTone];

  const contourStrokesData = pose.strokes
    .filter((s) => s.layer === 'contour' || s.layer === 'whiskers')
    .map((s) => ({
      name: s.id,
      width: Math.round(s.baseWidth * config.strokeWidthMultiplier * 10),
      opacity: s.inkOpacity,
      pts: s.points.map((pt) => [...toBlenderXZ(pt.x, pt.y), Number(pt.p.toFixed(2))]),
    }));

  const bambooStrokesData = pose.strokes
    .filter((s) => s.layer === 'bamboo' || s.layer === 'moon_ring')
    .map((s) => ({
      name: s.id,
      width: Math.round(s.baseWidth * config.strokeWidthMultiplier * 10),
      opacity: s.inkOpacity,
      pts: s.points.map((pt) => [...toBlenderXZ(pt.x, pt.y), Number(pt.p.toFixed(2))]),
    }));

  const bodyFillPoints = pose.washPolygons[0]?.points.map((pt) => toBlenderXZ(pt.x, pt.y)) ?? [];
  const eyesData = pose.eyes.map((e) => ({
    center: toBlenderXZ(e.cx, e.cy),
    rx: Number((e.rx / 100).toFixed(4)),
    ry: Number((e.ry / 100).toFixed(4)),
    angle: Number((-e.angle).toFixed(4)),
  }));
  const hankoCenter = toBlenderXZ(pose.hankoPos.x, pose.hankoPos.y);

  return `# ==============================================================================
# KURO — ESTUDIO IMPERIAL 2D (BLENDER GREASE PENCIL GENERATOR)
# Pose seleccionada : ${pose.title} (${pose.kanji})
# Acuarela de fondo : ${theme.name}
# Compatible con    : Blender 3.6 LTS / 4.x (Espacio de trabajo 2D Animation)
# ==============================================================================

import bpy
import math

def limpiar_escena():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

def crear_material_gp(nombre, color_stroke=None, color_fill=None):
    mat = bpy.data.materials.new(name=nombre)
    bpy.data.materials.create_gpencil_data(mat)
    gp_mat = mat.grease_pencil
    if color_stroke is not None:
        gp_mat.show_stroke = True
        gp_mat.color = (*color_stroke, 1.0)
    else:
        gp_mat.show_stroke = False
    if color_fill is not None:
        gp_mat.show_fill = True
        gp_mat.fill_color = color_fill
    else:
        gp_mat.show_fill = False
    return mat

def agregar_trazo(frame, puntos_x_y_p, mat_index, line_width=80, strength=0.95):
    trazo = frame.strokes.new()
    trazo.material_index = mat_index
    trazo.line_width = int(line_width)
    trazo.display_mode = '3DSPACE'
    trazo.points.add(len(puntos_x_y_p))
    for i, (x, y, z, p) in enumerate(puntos_x_y_p):
        trazo.points[i].co = (x, y, z)
        trazo.points[i].pressure = p
        trazo.points[i].strength = strength
    return trazo

def construir_gato_imperial_2d():
    limpiar_escena()
    scene = bpy.context.scene

    # 1. Configurar papel Xuan / acuarela de fondo en World & Color Management
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs[0].default_value = (${theme.blenderBgRgb[0]}, ${theme.blenderBgRgb[1]}, ${theme.blenderBgRgb[2]}, 1.0)
        bg_node.inputs[1].default_value = 1.0

    # 2. Cámara ortográfica 2D (Proporción 4:3)
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1440
    cam_data = bpy.data.cameras.new("Camara_2D_Imperial")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 10.0
    cam_obj = bpy.data.objects.new("Camara_2D_Imperial", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (0.0, -10.0, 0.0)
    cam_obj.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    scene.camera = cam_obj

    # 3. Crear objeto Grease Pencil 2D
    gp_data = bpy.data.grease_pencils.new("GP_GatoNegro_Imperial_Data")
    gp_obj = bpy.data.objects.new("GP_GatoNegro_Imperial", gp_data)
    scene.collection.objects.link(gp_obj)
    bpy.context.view_layer.objects.active = gp_obj

    # 4. Materiales Sumi-e y Acuarela
    mat_tinta = crear_material_gp("Mat_Tinta_Sumi", color_stroke=(0.03, 0.03, 0.03))
    mat_relleno = crear_material_gp("Mat_Relleno_Sumi", color_fill=(0.04, 0.04, 0.038, 0.88))
    mat_acuarela = crear_material_gp("Mat_Acuarela_Fondo", color_fill=(${theme.blenderWashRgb[0]}, ${theme.blenderWashRgb[1]}, ${theme.blenderWashRgb[2]}, ${Number((config.watercolorOpacity * 0.35).toFixed(2))}))
    mat_ojos = crear_material_gp("Mat_Ojos_Imperial", color_stroke=(0.15, 0.1, 0.05), color_fill=(${eyeTone.rgb[0]}, ${eyeTone.rgb[1]}, ${eyeTone.rgb[2]}, 1.0))
    mat_hanko = crear_material_gp("Mat_Sello_Hanko", color_fill=(0.69, 0.15, 0.11, 0.92))

    for m in (mat_tinta, mat_relleno, mat_acuarela, mat_ojos, mat_hanko):
        gp_obj.data.materials.append(m)

    # 5. Capas de Blender Grease Pencil
    layer_bg = gp_data.layers.new("Acuarela_Fondo", set_active=False)
    frame_bg = layer_bg.frames.new(1)

    layer_fill = gp_data.layers.new("Relleno_Sumi", set_active=False)
    frame_fill = layer_fill.frames.new(1)

    layer_ink = gp_data.layers.new("Trazos_Caligrafia", set_active=True)
    frame_ink = layer_ink.frames.new(1)

    layer_eyes = gp_data.layers.new("Ojos_Imperial", set_active=False)
    frame_eyes = layer_eyes.frames.new(1)

    layer_hanko = gp_data.layers.new("Sello_Hanko", set_active=False)
    frame_hanko = layer_hanko.frames.new(1)

    # 6. Lavado minimalista en acuarela (elipses orgánicas detrás del gato)
    acuarela_centros = ${JSON.stringify(pose.watercolorCenters.map((c) => ({ pos: toBlenderXZ(c.x, c.y), rx: Number((c.rx / 100).toFixed(3)), ry: Number((c.ry / 100).toFixed(3)) })))}
    for centro in acuarela_centros:
        cx, _, cz = centro["pos"]
        pts_wash = []
        for k in range(24):
            ang = (k / 24.0) * math.pi * 2.0
            pts_wash.append((cx + math.cos(ang) * centro["rx"], 0.05, cz + math.sin(ang) * centro["ry"], 1.0))
        tr = agregar_trazo(frame_bg, pts_wash, mat_index=2, line_width=10, strength=0.35)
        tr.use_cyclic = True

    # 7. Silueta base en aguada Sumi-e
    silueta_pts = ${JSON.stringify(bodyFillPoints.map((p) => [...p, 1.0]))}
    if silueta_pts:
        tr_sil = agregar_trazo(frame_fill, silueta_pts, mat_index=1, line_width=18, strength=0.85)
        tr_sil.use_cyclic = True

    # 8. Trazos caligráficos principales y bigotes
    trazos_gato = ${JSON.stringify(contourStrokesData, null, 4)}
    for t in trazos_gato:
        agregar_trazo(frame_ink, t["pts"], mat_index=0, line_width=t["width"], strength=t["opacity"])

    # 9. Bambú minimalista / Aro lunar
    trazos_bambu = ${JSON.stringify(bambooStrokesData, null, 4)}
    for b in trazos_bambu:
        agregar_trazo(frame_ink, b["pts"], mat_index=0, line_width=b["width"], strength=b["opacity"])

    # 10. Ojos imperiales
    ojos = ${JSON.stringify(eyesData)}
    for o in ojos:
        cx, _, cz = o["center"]
        pts_ojo = []
        for k in range(16):
            ang = (k / 16.0) * math.pi * 2.0
            lx = math.cos(ang) * o["rx"]
            lz = math.sin(ang) * o["ry"]
            rx = lx * math.cos(o["angle"]) - lz * math.sin(o["angle"])
            rz = lx * math.sin(o["angle"]) + lz * math.cos(o["angle"])
            pts_ojo.append((cx + rx, -0.02, cz + rz, 0.8))
        tr_o = agregar_trazo(frame_eyes, pts_ojo, mat_index=3, line_width=18, strength=0.95)
        tr_o.use_cyclic = True

    # 11. Sello tradicional Hanko en bermellón
    hx, _, hz = ${JSON.stringify(hankoCenter)}
    s = 0.23
    hanko_pts = [
        (hx - s, 0.0, hz - s, 1.0),
        (hx + s, 0.0, hz - s, 1.0),
        (hx + s, 0.0, hz + s, 1.0),
        (hx - s, 0.0, hz + s, 1.0),
    ]
    tr_h = agregar_trazo(frame_hanko, hanko_pts, mat_index=4, line_width=12, strength=0.92)
    tr_h.use_cyclic = True

    # 12. Modificadores para simular pincel seco y textura orgánica Sumi-e
    noise_mod = gp_obj.grease_pencil_modifiers.new(name="Pincel_Seco_Noise", type='GP_NOISE')
    noise_mod.layer = "Trazos_Caligrafia"
    noise_mod.factor = ${Number((config.dryBrushIntensity * 0.14).toFixed(3))}
    noise_mod.factor_thickness = ${Number((0.25 + config.dryBrushIntensity * 0.45).toFixed(2))}
    noise_mod.use_random = False

    thick_mod = gp_obj.grease_pencil_modifiers.new(name="Caligrafia_Grosor", type='GP_THICK')
    thick_mod.layer = "Trazos_Caligrafia"
    thick_mod.thickness_factor = ${Number(config.strokeWidthMultiplier.toFixed(2))}

    print("Gato Negro Imperial 2D creado correctamente en Blender Grease Pencil.")

if __name__ == "__main__":
    construir_gato_imperial_2d()
`;
}
