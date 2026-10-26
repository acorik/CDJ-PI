// =====================================================================
//  PÍO — micro droide pato con VLM (Raspberry Pi 5)
//  Modelo paramétrico OpenSCAD. Unidades: mm.
//
//  Ejes: X = derecha, Y = adelante (hacia donde mira), Z = arriba.
//
//  Uso:
//    openscad pio.scad                          -> ensamblaje (preview)
//    openscad -D 'part="head_front"' -o head_front.stl pio.scad
//  O usa ./export.sh para sacar todas las piezas imprimibles.
// =====================================================================

/* [Qué renderizar] */
part = "assembly"; // [assembly, exploded, cutaway, body_bottom, body_top, chassis, head_front, head_back, visor, beak, neck, foot_left, foot_right, tail, antenna]

/* [Pose del cuello en el ensamblaje (grados)] */
pan  = 0;   // giro izquierda/derecha
tilt = 0;   // asentir (+ mira arriba)
roll = 0;   // ladear la cabeza (el gesto "¿eh?")

/* [Opciones] */
show_internals = false; // muestra Pi, batería, motores y servos
antennas = true;        // antenas (opcionales, 2x SG90)
blush = true;           // coloretes (en la vida real: pintura o vinilo)

$fn = 72;

// ---------------------------------------------------------------------
// Parámetros generales
// ---------------------------------------------------------------------
wall = 2.4;      // pared de las carcasas (6 perímetros de 0.4)
tol  = 0.3;      // holgura de encaje

// Ruedas (motor N20 + rueda de 43 mm)
wheel_d     = 43;
wheel_w     = 18;
wheel_track = 104;            // distancia entre centros de rueda
axle_z      = wheel_d / 2;
axle_y      = 14;             // ruedas adelantadas: el CdG (cabezón) queda entre ruedas y bola loca

// Cuerpo (huevo)
body_w   = 120;
body_d   = 132;
body_h   = 100;
body_z0  = 12;                          // cota inferior del huevo (sin aplanar)
body_cz  = body_z0 + body_h / 2;        // centro del huevo
body_flat = 31;                         // base plana: el chasis va debajo y los motores cuelgan de él
base_k   = sqrt(1 - pow((body_cz - body_flat) / (body_h / 2), 2));
base_w   = body_w * base_k;             // tamaño de la sección del huevo en la base
base_d   = body_d * base_k;
split_z  = body_cz + 6;                 // corte entre mitad inferior y superior

// Cuello
neck_d   = 34;
neck_y   = 6;
neck_h   = 22;
neck_top = body_cz + body_h / 2 - 6 + neck_h;

// Cabeza (caja redondeada, proporciones chibi: más ancha que el cuerpo)
head_w  = 128;
head_d  = 96;
head_h  = 82;
head_r  = 26;                            // radio de redondeo
head_cz = neck_top + head_h / 2 - 4;
head_cy = neck_y + 8;
head_split_y = 6;                        // corte frontal/trasero (rel. al centro)

// Visera (pantalla SPI 2.0–2.8" 320x240 detrás de un frontal tintado)
visor_w = 86;
visor_h = 50;
visor_r = 16;
visor_dz = 10;                           // por encima del centro: deja sitio al pico
screen_pcb = [86, 50, 4];                // módulo 2.8" ILI9341 / ST7789 (ajusta al tuyo)

// Pico = alojamiento de la cámara (Camera Module 3: 25x24 mm, lente d≈8)
beak_w = 48;
beak_h = 32;                             // alto en la raíz (la cámara vive ahí)
beak_d = 26;
cam_board = [25, 24, 12];
cam_lens_d = 8.5;
beak_z = visor_dz - visor_h / 2 - beak_h / 2 - 1;   // justo bajo la visera

// Servo MG90S/SG90 (cuerpo)
servo = [22.8, 12.4, 22.7];
servo_tab_w = 32.4;

// Colores
c_shell  = "#F3EFE4";   // crema
c_accent = "#FF9F1C";   // naranja pato
c_dark   = "#1F2233";   // visera / gomas
c_eye    = "#A6F2FF";   // ojos
c_blush  = "#FF8FA3";
c_pcb    = "#2E7D32";
c_metal  = "#9AA0A6";

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
module ellipsoid(size) { scale(size / 2) sphere(1); }

module rounded_box(size, r) {
    // caja redondeada centrada en el origen
    hull() for (x = [-1, 1], y = [-1, 1], z = [-1, 1])
        translate([x * (size[0] / 2 - r), y * (size[1] / 2 - r), z * (size[2] / 2 - r)])
            sphere(r);
}

module rounded_rect(w, h, r, t) {
    // placa redondeada en el plano XZ, extruida t hacia +Y
    rotate([-90, 0, 0]) linear_extrude(t)
        offset(r) square([w - 2 * r, h - 2 * r], center = true);
}

module above(z) { intersection() { children(); translate([-500, -500, z]) cube(1000); } }
module below(z) { intersection() { children(); translate([-500, -500, z - 1000]) cube(1000); } }
module front_of(y) { intersection() { children(); translate([-500, y, -500]) cube(1000); } }
module behind(y)   { intersection() { children(); translate([-500, y - 1000, -500]) cube(1000); } }

// ---------------------------------------------------------------------
// Cuerpo
// ---------------------------------------------------------------------
module body_solid() {
    above(body_flat) translate([0, 0, body_cz]) ellipsoid([body_w, body_d, body_h]);
}

module body_shell() {
    difference() {
        body_solid();
        above(body_flat - 1)
            translate([0, 0, body_cz]) ellipsoid([body_w - 2 * wall, body_d - 2 * wall, body_h - 2 * wall]);
        // agujero del cuello (con holgura para el giro)
        translate([0, neck_y, body_cz]) cylinder(d = neck_d + 4, h = body_h);
        // pasos de rueda
        for (s = [-1, 1]) translate([s * wheel_track / 2, axle_y, axle_z])
            rotate([0, 90, 0]) cylinder(d = wheel_d + 6, h = wheel_w + 6, center = true);
        // rejilla del altavoz (pecho)
        for (i = [-2:2], j = [0:2])
            translate([i * 6, body_d / 2 - 12, body_cz - 22 + j * 6 + (abs(i) % 2) * 3])
                rotate([-90, 0, 0]) cylinder(d = 3.2, h = 20, $fn = 16);
        // ventilación trasera (la Pi 5 se calienta con la VLM)
        for (i = [-3:3])
            translate([i * 9, -body_d / 2 + 6, body_cz - 10])
                rotate([90, 0, 0]) hull() {
                    translate([0, -10, 0]) cylinder(d = 4, h = 20, center = true, $fn = 16);
                    translate([0, 10, 0])  cylinder(d = 4, h = 20, center = true, $fn = 16);
                }
        // USB-C de carga / interruptor (lateral izquierdo)
        translate([-body_w / 2, -28, body_flat + 18]) cube([20, 12, 7], center = true);
        translate([-body_w / 2, -46, body_flat + 18]) cube([20, 13, 8.5], center = true);
    }
    // labio de encaje en el corte
    color(c_shell) difference() {
        above(split_z - 4) below(split_z + 3)
            translate([0, 0, body_cz]) ellipsoid([body_w - 2 * wall + 0.01, body_d - 2 * wall + 0.01, body_h - 2 * wall]);
        translate([0, 0, body_cz]) ellipsoid([body_w - 4 * wall, body_d - 4 * wall, body_h - 4 * wall]);
    }
}

module body_bottom() { color(c_shell) below(split_z) body_shell(); }
module body_top()    {
    color(c_shell) difference() {
        above(split_z) body_shell();
        // hueco del labio de la mitad inferior
        above(split_z - 1) below(split_z + 3 + tol)
            translate([0, 0, body_cz]) ellipsoid([body_w - 2 * wall + 2 * tol, body_d - 2 * wall + 2 * tol, body_h]);
    }
    // soporte del servo de giro (pan), colgado del techo
    color(c_shell) translate([0, neck_y, body_cz + body_h / 2 - 6 - wall - servo[2] / 2 - 2])
        difference() {
            cube([servo_tab_w + 10, servo[1] + 8, 4], center = true);
            cube([servo[0] + tol, servo[1] + tol, 10], center = true);
            for (s = [-1, 1]) translate([s * 14, 0, 0]) cylinder(d = 2, h = 10, center = true, $fn = 12);
        }
}

// ---------------------------------------------------------------------
// Chasis interior (placa base: Pi 5, batería, motores, caster)
// ---------------------------------------------------------------------
pi_holes = [[-24.5, -29], [24.5, -29], [-24.5, 29], [24.5, 29]]; // Pi 5: 49 x 58 mm
pi_y     = -4;                      // la Pi va encima de la batería, con el lado largo hacia delante
pi_z     = body_flat + 24;
batt     = [37, 68, 19];            // pack 2S 18650 termorretráctil con BMS
batt_y   = -6;
motor_len = 37;                     // N20 con reductora + encoder
motor_x0 = wheel_track / 2 - wheel_w / 2 - 2;   // cara interior de la rueda
// bola loca comercial de 3/4" (p. ej. Pololu): MIDE la tuya y ajusta estas dos cotas
caster_h = 16;                      // altura desde el suelo hasta su cara de montaje
caster_holes = 19;                  // distancia entre sus tornillos
caster_y = -42;

module chassis() {
    color("#D9D4C7") difference() {
        union() {
            // placa base: cierra el huevo por debajo
            translate([0, 0, body_flat - 3]) linear_extrude(3) scale([base_w / 2, base_d / 2]) circle(1);
            // reborde que encaja dentro del cascarón
            translate([0, 0, body_flat]) linear_extrude(4) difference() {
                scale([base_w / 2 - wall - tol, base_d / 2 - wall - tol]) circle(1);
                scale([base_w / 2 - 2 * wall - tol, base_d / 2 - 2 * wall - tol]) circle(1);
            }
            // pilares de la Pi 5
            for (h = pi_holes) translate([h[0], pi_y + h[1], body_flat]) cylinder(d = 6, h = pi_z - body_flat, $fn = 24);
            // guías laterales de la batería (va sujeta con una brida de velcro)
            translate([0, batt_y, body_flat + 3]) difference() {
                cube([batt[0] + 6, batt[1] - 10, 6], center = true);
                cube([batt[0] + 2 * tol, batt[1], 8], center = true);
            }
            // abrazaderas de los motores N20, colgando bajo la placa
            for (s = [-1, 1]) translate([s * (motor_x0 - 14), axle_y, (axle_z - 7 + body_flat) / 2])
                cube([22, 18, body_flat - (axle_z - 7)], center = true);
        }
        for (h = pi_holes) translate([h[0], pi_y + h[1], body_flat + 8]) cylinder(d = 2.5, h = 40, $fn = 16);
        for (s = [-1, 1]) translate([s * (motor_x0 - motor_len / 2), axle_y, axle_z])
            cube([motor_len + 2, 12.4, 10.4], center = true);
        // paso de cables de los motores y sensores de borde
        for (s = [-1, 1]) translate([s * 22, axle_y + 14, body_flat]) cube([10, 8, 10], center = true);
    }
    // poste para la bola loca (comprada) bajo la cola
    color("#D9D4C7") translate([0, caster_y, caster_h]) difference() {
        cylinder(d = 24, h = body_flat - 3 - caster_h + 0.01);
        for (a = [0, 180]) rotate(a) translate([caster_holes / 2, 0, -1]) cylinder(d = 2.5, h = 12, $fn = 16);
    }
}

module caster() {
    color(c_metal) translate([0, caster_y, 0]) {
        translate([0, 0, 9.5]) sphere(d = 19);
        translate([0, 0, 9.5]) cylinder(d = 22, h = caster_h - 9.5);
    }
}

// ---------------------------------------------------------------------
// Patas-ruedas: "botas" naranjas que esconden cada rueda + dedos palmeados
// ---------------------------------------------------------------------
module foot(side = 1) {
    x = side * wheel_track / 2;
    color(c_accent) difference() {
        union() {
            // guardabarros (deja ver el tercio inferior de la rueda)
            translate([x, axle_y, axle_z + wheel_d * 0.25])
                rounded_box([wheel_w + 10, wheel_d + 14, wheel_d * 0.8], 11);
            // tobillo que baja delante de la rueda
            hull() {
                translate([x, axle_y + wheel_d / 2 + 6, 9]) sphere(r = 6);
                translate([x, axle_y + wheel_d / 2, axle_z + 4]) sphere(r = 9);
            }
            // dedos palmeados (3 lóbulos), flotan 6 mm sobre el suelo
            translate([x, axle_y + wheel_d / 2 + 8, 6]) linear_extrude(5) hull() {
                for (a = [-28, 0, 28]) rotate(a) translate([0, 16]) circle(d = 13);
                translate([0, -4]) circle(d = 20);
            }
        }
        // hueco de la rueda (abierto por abajo)
        translate([x, axle_y, axle_z]) rotate([0, 90, 0]) cylinder(d = wheel_d + 4, h = wheel_w + 3, center = true);
        translate([x - (wheel_w + 3) / 2, axle_y - wheel_d / 2 - 2, -10]) cube([wheel_w + 3, wheel_d + 4, axle_z + 10]);
        // eje / motor pasa hacia dentro
        translate([x - side * 10, axle_y, axle_z]) rotate([0, 90, 0]) cylinder(d = 14, h = 20, center = true);
    }
}

module wheel(side = 1) {
    translate([side * wheel_track / 2, axle_y, axle_z]) rotate([0, 90, 0]) {
        color(c_dark) cylinder(d = wheel_d, h = wheel_w, center = true);
        color(c_accent) cylinder(d = wheel_d - 14, h = wheel_w + 0.4, center = true);
    }
}

// ---------------------------------------------------------------------
// Cola (con un pelín de rebeldía)
// ---------------------------------------------------------------------
module tail() {
    color(c_shell) translate([0, -body_d / 2 + 10, body_cz + 6]) rotate([38, 0, 0])
        hull() {
            scale([1.2, 1, 1]) sphere(d = 28);
            translate([0, 2, 24]) scale([2.4, 0.6, 1]) sphere(d = 10);
        }
}

// ---------------------------------------------------------------------
// Cuello (columna que gira con el servo pan; arriba la horquilla tilt)
// ---------------------------------------------------------------------
module neck() {
    z0 = body_cz + body_h / 2 - 14;
    translate([0, neck_y, z0]) {
        color(c_dark) difference() {
            cylinder(d = neck_d, h = neck_top - z0);
            translate([0, 0, -1]) cylinder(d = neck_d - 2 * wall, h = neck_top - z0 + 2);
        }
        // collar naranja
        color(c_accent) translate([0, 0, 12]) difference() {
            cylinder(d = neck_d + 6, h = 6);
            translate([0, 0, -1]) cylinder(d = neck_d - 1, h = 8);
        }
    }
}

// ---------------------------------------------------------------------
// Cabeza
// ---------------------------------------------------------------------
module head_solid() { rounded_box([head_w, head_d, head_h], head_r); }

module head_shell() {
    difference() {
        head_solid();
        rounded_box([head_w - 2 * wall, head_d - 2 * wall, head_h - 2 * wall], head_r - wall);
        // ventana de la visera
        translate([0, head_d / 2 - 8, visor_dz]) rounded_rect(visor_w, visor_h, visor_r, 20);
        // alojamiento del pico/cámara
        translate([0, head_d / 2 - 10, beak_z]) cube([cam_board[0] + 1, 20, cam_board[1] + 1], center = true);
        // hueco del cuello
        translate([0, neck_y - head_cy, -head_h / 2 - 1]) cylinder(d = neck_d + 10, h = 12);
        // micrófono (arriba) y antenas
        translate([0, 8, head_h / 2 - 5]) cylinder(d = 2, h = 10, $fn = 12);
        if (antennas) for (s = [-1, 1]) translate([s * 34, -6, head_h / 2 - 5]) cylinder(d = 7, h = 10);
    }
}

module head_front() {
    color(c_shell) front_of(head_split_y) head_shell();
    // marco de la pantalla
    color(c_shell) intersection() {
        rounded_box([head_w - wall, head_d - wall, head_h - wall], head_r - wall / 2);
        translate([0, head_d / 2 - wall - 3 - screen_pcb[2], visor_dz]) difference() {
            cube([screen_pcb[0] + 8, 3, screen_pcb[1] + 8], center = true);
            cube([screen_pcb[0] - 6, 10, screen_pcb[1] - 6], center = true);
        }
    }
}

module head_back() {
    color(c_shell) difference() {
        behind(head_split_y) head_shell();
        // tapa trasera con rejilla (respira la pantalla y el servo)
        for (i = [-2:2]) translate([i * 10, -head_d / 2, 10])
            rotate([90, 0, 0]) cylinder(d = 5, h = 10, center = true, $fn = 20);
    }
    // soporte del servo tilt (eje X), base de la cabeza
    color(c_shell) translate([0, neck_y - head_cy, -head_h / 2 + wall + 8]) difference() {
        cube([servo_tab_w + 10, servo[1] + 10, 16], center = true);
        cube([servo[0] + tol, servo[1] + tol, 20], center = true);
    }
}

module visor() {
    // frontal tintado: imprime en PLA/PETG negro translúcido, o corta metacrilato ahumado de 2 mm
    color(c_dark, 0.92) translate([0, head_d / 2 - 8.2, visor_dz]) rounded_rect(visor_w - 2 * tol, visor_h - 2 * tol, visor_r - tol, 8);
}

module eyes_preview() {
    // solo para la vista previa: lo que dibuja la pantalla (ojos grandes = +mono)
    for (s = [-1, 1]) translate([s * 20, head_d / 2 + 0.1, visor_dz + 1]) rotate([-90, 0, 0]) {
        color(c_eye) linear_extrude(0.4) scale([1, 1.18]) circle(d = 25);
        color("white") translate([5, -6, 0]) linear_extrude(0.8) circle(d = 8);
        color("white") translate([-4, 5, 0]) linear_extrude(0.8) circle(d = 3.5);
    }
}

module beak() {
    // El pico ES la carcasa de la cámara: alto en la raíz (ahí va la placa de la
    // Camera Module 3 en vertical) y baja hacia la punta. La lente asoma por la
    // parte alta de la raíz, así que la punta queda fuera del campo de visión.
    color(c_accent) translate([0, head_d / 2 - 8, beak_z]) difference() {
        hull() {
            scale([beak_w / 2, 7, beak_h / 2]) sphere(1);
            translate([0, beak_d - 7, -beak_h / 2 + 8]) scale([beak_w / 2 - 4, 7, 7]) sphere(1);
        }
        // placa de la cámara (entra por detrás, desde la cabeza)
        translate([0, -8, 0]) cube([cam_board[0] + tol, 16, cam_board[1] + tol], center = true);
        // lente
        translate([0, 0, 0]) rotate([-90, 0, 0]) cylinder(d = cam_lens_d, h = 30);
    }
}

module antenna(side = 1) {
    color(c_dark) translate([side * 34, -6, head_h / 2 - 4]) rotate([side * -12, 0, side * 10]) {
        cylinder(d = 3, h = 24, $fn = 16);
        color(c_accent) translate([0, 0, 26]) sphere(d = 9);
    }
}

module blush_marks() {
    // "calcomanía" que sigue la superficie de la cabeza
    for (s = [-1, 1]) color(c_blush) intersection() {
        difference() {
            rounded_box([head_w + 1, head_d + 1, head_h + 1], head_r + 0.5);
            head_solid();
        }
        translate([s * (visor_w / 2 + 11), 0, visor_dz - visor_h / 2 - 1]) rotate([-90, 0, 0])
            scale([1.5, 1, 1]) cylinder(d = 11, h = head_d);
    }
}

module head_assembly(exploded = false) {
    e = exploded ? 1 : 0;
    translate([0, head_cy, head_cz]) {
        translate([0, e * 30, 0])  head_front();
        translate([0, -e * 30, 0]) head_back();
        translate([0, e * 60, 0]) { visor(); eyes_preview(); }
        translate([0, e * 90, 0])  beak();
        if (antennas) translate([0, 0, e * 30]) { antenna(-1); antenna(1); }
        if (blush) translate([0, e * 30, 0]) blush_marks();
        if (show_internals) {
            color(c_pcb) translate([0, head_d / 2 - wall - 6 - screen_pcb[2] / 2, visor_dz]) cube([screen_pcb[0], screen_pcb[2], screen_pcb[1]], center = true);
            color("#3949AB") translate([0, neck_y - head_cy, -head_h / 2 + wall + 8]) cube(servo, center = true);
        }
    }
}

// ---------------------------------------------------------------------
// Internos (solo visualización)
// ---------------------------------------------------------------------
module internals() {
    // batería 2S
    color("#1565C0") translate([0, batt_y, body_flat + batt[2] / 2]) cube(batt, center = true);
    // Raspberry Pi 5 con disipador activo
    color(c_pcb) translate([0, pi_y, pi_z]) cube([56, 85, 1.6], center = true);
    color(c_metal) translate([0, pi_y + 10, pi_z + 6]) cube([40, 40, 10], center = true);
    // motores N20
    for (s = [-1, 1]) color(c_metal)
        translate([s * (motor_x0 - motor_len / 2), axle_y, axle_z]) cube([motor_len, 12, 10], center = true);
    // servo pan
    color("#3949AB") translate([0, neck_y, body_cz + body_h / 2 - 6 - wall - servo[2] / 2 + 6]) cube(servo, center = true);
    // altavoz
    color("#424242") translate([0, body_d / 2 - 16, body_cz - 14]) rotate([-90, 0, 0]) cylinder(d = 28, h = 5);
}

// ---------------------------------------------------------------------
// Ensamblajes
// ---------------------------------------------------------------------
module droid(exploded = false) {
    e = exploded ? 1 : 0;
    translate([0, 0, e * 40]) body_top();
    body_bottom();
    if (show_internals) { chassis(); caster(); internals(); }
    for (s = [-1, 1]) translate([s * e * 30, 0, 0]) { foot(s); wheel(s); }
    tail();
    translate([0, 0, e * 70]) neck();
    // la cabeza gira alrededor de la base del cuello
    translate([0, neck_y, neck_top]) rotate([0, 0, pan]) rotate([tilt, 0, 0]) rotate([0, roll, 0])
        translate([0, -neck_y, -neck_top + e * 110]) head_assembly(exploded);
}

module cutaway() {
    // medio droide cortado por el plano X=0 para ver dónde va cada cosa
    intersection() {
        droid();
        translate([-500, -500, -500]) cube([500, 1000, 1000]);
    }
    chassis(); caster(); internals();
    translate([0, head_cy, head_cz]) {
        color(c_pcb) translate([0, head_d / 2 - wall - 6 - screen_pcb[2] / 2, visor_dz]) cube([screen_pcb[0], screen_pcb[2], screen_pcb[1]], center = true);
        color(c_pcb) translate([0, head_d / 2 - 8 - 8, beak_z]) cube([cam_board[0], 2, cam_board[1]], center = true);
        color("#3949AB") translate([0, neck_y - head_cy, -head_h / 2 + wall + 8]) cube(servo, center = true);
    }
}

// ---------------------------------------------------------------------
// Selector de piezas (orientadas para imprimir; el laminador las baja a la cama)
// ---------------------------------------------------------------------
if (part == "assembly") droid();
else if (part == "exploded") droid(true);
else if (part == "cutaway") cutaway();
else if (part == "body_bottom") translate([0, 0, -body_flat]) body_bottom();
else if (part == "body_top") translate([0, 0, -split_z]) body_top();
else if (part == "chassis") translate([0, 0, -body_flat + 3]) chassis();
else if (part == "head_front") rotate([-90, 0, 0]) translate([0, -head_d / 2, 0]) head_front();
else if (part == "head_back") rotate([90, 0, 0]) translate([0, head_d / 2, 0]) head_back();
else if (part == "visor") rotate([90, 0, 0]) visor();
else if (part == "beak") rotate([90, 0, 0]) translate([0, -(head_d / 2 - 8), -beak_z]) beak();
else if (part == "neck") neck();
else if (part == "foot_left") foot(-1);
else if (part == "foot_right") foot(1);
else if (part == "tail") tail();
else if (part == "antenna") antenna(1);
