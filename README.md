# Mosca-Jalera

Simulación 3D de una mosca de la fruta (*Drosophila melanogaster*) expuesta a estímulos de recompensa: etanol, nicotina, cocaína, una tragamonedas y un feed de reels. La mosca decide por sí misma qué hacer; el usuario solo modifica el entorno y aplica intervenciones.

## Qué modela

- **Navegación sensoriomotora:** cada estación emite olor o luz, y la mosca lo capta con sensores bilaterales. El giro sale del contraste entre izquierda y derecha, ponderado por su motivación.
- **Decisión y aprendizaje:** el valor de cada opción depende del hambre, el sueño, la abstinencia, la saciedad y la novedad, y se actualiza con el error de predicción de recompensa (dopamina PAM/PPL1, salidas MBON).
- **Farmacología:** tolerancia, abstinencia, saciedad, malestar tóxico y búsqueda resistente a la aversión. La cocaína se autorregula por dopamina. Los daños están atenuados respecto de la realidad.
- **Individualidad:** cada sujeto nace con un perfil propio de sensibilidades, aprendizaje, búsqueda de novedad y sesgo de giro.
- **Registro:** el panel muestra el etograma y las series temporales, y los datos se exportan a CSV.

## Qué es real y qué es modelo

- **Datos reales:**
  - Connectome MaleCNS v1.0 (Janelia y Google Research, Cell 2026): sistema nervioso central completo de un macho, con 165.122 neuronas.
  - El cuerpo de [flybody](https://github.com/TuragaLab/flybody) (Vaxenburg et al., Nature 2025).
- **Simulación del connectome:** las 165.122 neuronas corren en vivo como un modelo LIF (parámetros de Shiu et al., Nature 2024) sobre sus 6,1 millones de conexiones. Los sentidos entran por neuronas sensoriales reales. Las neuronas descendentes y motoras reales deciden el escape (Giant Fiber), el giro (DNa01/02), el retroceso (MDN) y la extensión de probóscide (MN9).
- **Modelo fenomenológico:** la motivación, el aprendizaje por dopamina y la farmacología de alto nivel.
- **Parámetros:** son ilustrativos y no están ajustados a datos experimentales.

## Uso

Requiere Python 3 y un navegador.

```
iniciar.bat    abre el servidor local y la simulación en http://localhost:8765/
cerrar.bat     detiene el servidor
```

## Referencias principales

- Shohat-Ophir et al. (2012). Science. Rechazo sexual, NPF y preferencia por etanol.
- Kaun et al. (2011). Nature Neuroscience. Recompensa por etanol y búsqueda resistente a la aversión.
- McClung & Hirsh (1998). Current Biology. Respuestas estereotipadas a la cocaína.
- Moore et al. (1998). Cell. Intoxicación por etanol en *Drosophila*.
- Tsibulsky & Norman (1999). Brain Research. Umbral de saciedad en autoadministración de cocaína.
- Buchanan, Kain & de Bivort (2015). PNAS. Individualidad en la lateralidad locomotora.

## Licencia

Código bajo licencia MIT. Los datos y modelos de terceros conservan sus licencias: flybody (Apache-2.0) y MaleCNS (CC-BY 4.0).
