//! Icono de la bandeja dibujado en código (sin archivos): el isotipo de Selyh, un cuadrado índigo
//! con las dos barras de pausa (alta blanca, corta índigo suave). Con un check-in pendiente se
//! agrega un punto índigo suave con borde azul tinta (nunca rojo ni contadores).

use tauri::image::Image;

const SIZE: u32 = 32;
const INDIGO: [u8; 3] = [0x63, 0x63, 0xf1];
const SOFT: [u8; 3] = [0xa2, 0xa2, 0xfa];
const WHITE: [u8; 3] = [0xff, 0xff, 0xff];
const NIGHT: [u8; 3] = [0x0f, 0x15, 0x23];

fn blend(px: &mut [u8], rgb: [u8; 3], alpha: f32) {
    let a = alpha.clamp(0.0, 1.0);
    let old = px[3] as f32 / 255.0;
    let out = a + old * (1.0 - a);
    for i in 0..3 {
        let c = rgb[i] as f32 * a + px[i] as f32 * old * (1.0 - a);
        px[i] = if out > 0.0 { (c / out) as u8 } else { 0 };
    }
    px[3] = (out * 255.0) as u8;
}

/// Cobertura con antialias de un rectángulo redondeado (x, y, ancho, alto, radio) para el píxel.
fn rounded(px: u32, py: u32, (x, y, w, h, r): (f32, f32, f32, f32, f32)) -> f32 {
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    let qx = (px as f32 + 0.5 - cx).abs() - (w / 2.0 - r);
    let qy = (py as f32 + 0.5 - cy).abs() - (h / 2.0 - r);
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    let d = outside + qx.max(qy).min(0.0) - r;
    (0.5 - d).clamp(0.0, 1.0)
}

fn disc(x: u32, y: u32, cx: f32, cy: f32, r: f32) -> f32 {
    let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
    (r - d + 0.5).clamp(0.0, 1.0)
}

pub fn tray(pending: bool) -> Image<'static> {
    // Retícula del isotipo (64) a la mitad: contenedor radio 8, barras de ancho 6,5.
    let mut buf = vec![0u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let px = &mut buf[((y * SIZE + x) * 4) as usize..][..4];
            blend(px, INDIGO, rounded(x, y, (0.0, 0.0, 32.0, 32.0, 8.0)));
            blend(px, WHITE, rounded(x, y, (8.5, 5.5, 6.5, 21.0, 3.25)));
            blend(px, SOFT, rounded(x, y, (17.5, 13.5, 6.5, 13.0, 3.25)));
            if pending {
                blend(px, NIGHT, disc(x, y, 26.0, 6.0, 6.0));
                blend(px, SOFT, disc(x, y, 26.0, 6.0, 4.0));
            }
        }
    }
    Image::new_owned(buf, SIZE, SIZE)
}
