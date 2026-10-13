# REGLAS INNEGOCIABLES DEL SISTEMA DE PRÉSTAMOS NO BANCARIOS

**Estado:** Documento rector del proyecto  
**Prioridad:** Alta — decisiones funcionales aprobadas por la propietaria del sistema  
**Fecha:** 13 de octubre de 2026

## 1. Principio fundamental

**EL SISTEMA DEBE ADAPTARSE A LA OPERACIÓN REAL DEL NEGOCIO. LA OPERACIÓN DEL NEGOCIO NO DEBE ADAPTARSE A UNA ARQUITECTURA ARTIFICIALMENTE COMPLEJA.**

Toda implementación debe resolver el requerimiento solicitado de la manera más sencilla, segura y mantenible posible.

No se autoriza introducir complejidad técnica sin demostrar primero su necesidad.

El hecho de que una solución sea técnicamente sofisticada no significa que sea funcionalmente correcta.

## 2. Plan de pagos único, mutable y dinámico

El sistema debe mantener **UN SOLO PLAN DE CUOTAS OPERATIVO VIGENTE POR PRÉSTAMO**.

El calendario inicial se utiliza para establecer las cuotas al crear el préstamo.

Una vez creado, ese calendario puede modificarse por pagos reales, personalizaciones autorizadas y otras operaciones financieras válidas.

El calendario original NO debe conservarse como una versión operativa inalterable que prevalezca sobre el plan vigente.

La tabla `payment_plan_entries` representa el plan operativo actual.

No deben mantenerse múltiples calendarios competidores ni reconstruirse automáticamente el calendario inicial para reemplazar las modificaciones legítimas del plan.

## 3. Registro de pagos

El sistema debe registrar fielmente:

- Monto real entregado por el cliente.
- Fecha efectiva en que el cliente pagó.
- Capital realmente aplicado.
- Interés realmente aplicado.
- Identidad del cobrador, cuando corresponda.
- Estado del pago.

**Regla financiera obligatoria: primero capital y después intereses.**

Los pagos deben aplicarse a las obligaciones positivas más antiguas, respetando el orden cronológico y los criterios de desempate definidos.

El cliente puede pagar un importe inferior, igual o superior al de una cuota.

No se permite inventar pagos, alterar montos recibidos ni modificar fechas efectivas para acomodar el calendario.

## 4. Reorganización automática de cuotas

Después de registrar y aplicar un pago real:

1. Actualizar el plan vigente.
2. Identificar las obligaciones que todavía tengan saldo pendiente y fecha menor o igual a la fecha efectiva del pago.
3. Trasladar esos importes pendientes a la primera cuota pagable con fecha estrictamente posterior a la fecha efectiva del pago.
4. Dejar en cero el pendiente operativo de las cuotas de origen.
5. Incrementar la cuota futura por exactamente el importe trasladado.
6. Mantener inalterado el saldo financiero total por efecto del traslado.

La reorganización es una modificación del calendario, NO un nuevo pago.

Una cuota con pendiente cero por reorganización NO debe clasificarse automáticamente como pagada.

Si no existe una cuota futura válida, la operación debe seguir una regla explícita y aprobada; no debe inventar cuotas ni descartar importes.

## 5. Ejemplos funcionales obligatorios

### Caso #4753

Pago real del 08/10/2026: ₡11.200.

Resultado esperado:

- Cuota #1, 07/10: pendiente ₡0.
- Cuota #2, 14/10: pendiente ₡12.800.
- Saldo financiero: ₡48.800.

El pago registrado sigue siendo ₡11.200. No se inventan los ₡800 faltantes.

### Caso #4764

Pago real del 12/10/2026: ₡50.000.

Resultado esperado:

- Cuotas #7, #8 y #9: pendiente ₡0.
- Cuota #10, 13/10: pendiente ₡200.000.
- Saldo financiero: ₡1.350.000.

Los ₡150.000 trasladados no son pagos recibidos.

Estos ejemplos son casos de aceptación funcional, no autorizaciones para modificar directamente préstamos reales.

## 6. Personalizar plan de pagos

La opción **Personalizar plan de pagos** modifica el plan operativo vigente.

No debe obligar al usuario a regresar al calendario original.

Debe permitir modificaciones financieramente válidas sin alterar el historial de dinero recibido.

Una cuota relacionada con un pago no debe quedar totalmente inmutable por ese solo hecho. Deben protegerse las aplicaciones reales y los importes efectivamente pagados, permitiendo las modificaciones del pendiente que sean seguras.

Las validaciones deben proteger la integridad financiera, no impedir innecesariamente la operación.

## 7. Historial financiero y anulaciones

Es obligatorio conservar:

- Pagos reales.
- Aplicaciones financieras necesarias.
- Anulaciones.
- Movimientos de Caja.
- Evidencia mínima necesaria para revertir operaciones con seguridad.

No es un requerimiento conservar indefinidamente cada versión del calendario original ni crear un historial independiente para cada traslado operativo.

La anulación debe ser transaccional, respetar las restricciones financieras existentes y restaurar correctamente el saldo.

No se permite borrar historia financiera, inventar movimientos compensatorios ni recalcular silenciosamente importes reales.

Si una anulación no puede realizarse de forma segura, debe rechazarse con un error claro y específico.

## 8. Conciliaciones obligatorias

En todo momento deben cumplirse las siguientes invariantes:

**Monto del pago = capital aplicado + interés aplicado.**

**Total contractual vigente del préstamo = pagos válidos acumulados + saldo financiero pendiente**, considerando los ajustes contractuales autorizados.

**Suma de pendientes del plan vigente = saldo financiero pendiente.**

Los traslados entre cuotas no pueden modificar el dinero recibido, el capital recuperado ni la ganancia realizada.

No se deben eliminar restricciones de integridad para ocultar errores.

## 9. Simplicidad arquitectónica

Antes de crear una tabla, servicio, repositorio, evento, bandera o subsistema nuevo, el agente debe responder:

1. ¿Qué requerimiento funcional explícito lo exige?
2. ¿Por qué no puede resolverse reutilizando las estructuras existentes?
3. ¿Qué problema concreto evita?
4. ¿Qué costo de mantenimiento introduce?
5. ¿Qué sucede con las anulaciones y los datos existentes?

Si no existe una justificación suficiente, NO debe agregarse.

Se debe priorizar la reutilización de `payments`, `payment_applications`, `payment_annulments` y `payment_plan_entries`, junto con los movimientos de Caja existentes.

Esta preferencia no autoriza eliminar información indispensable para restaurar operaciones financieras.

## 10. Prohibición de ampliar el alcance

Un requerimiento puntual NO autoriza:

- Rediseñar módulos completos.
- Crear subsistemas adicionales.
- Incorporar nuevas pantallas.
- Agregar historiales no solicitados.
- Cambiar reglas financieras aprobadas.
- Refactorizar componentes ajenos.
- Modificar contratos públicos sin necesidad demostrada.
- Introducir nuevas etapas de desarrollo por iniciativa propia.

Si una necesidad adicional aparece durante el trabajo, debe informarse y solicitar autorización ANTES de implementarla.

## 11. Protección del funcionamiento existente

**LO QUE YA FUNCIONA NO DEBE ROMPERSE PARA IMPLEMENTAR UNA MEJORA.**

Antes de modificar un flujo existente:

1. Identificar su comportamiento actual.
2. Identificar las reglas funcionales aprobadas.
3. Establecer pruebas que protejan ese comportamiento.
4. Implementar únicamente el cambio solicitado.
5. Ejecutar pruebas enfocadas y regresiones proporcionales.
6. Comprobar que las operaciones anteriores continúan funcionando.

Una implementación no se considera terminada si rompe registro de pagos, personalización, anulaciones, Caja o conciliación financiera.

## 12. Seguridad de datos

Nunca modificar préstamos reales, pagos, anulaciones o movimientos de Caja sin autorización explícita.

Nunca ejecutar migraciones sobre producción por iniciativa propia.

Nunca corregir datos históricos silenciosamente.

Las pruebas que escriban datos deben utilizar bases desechables y verificadas.

No ejecutar commits, pushes ni despliegues sin autorización.

No eliminar tablas o registros históricos sin inventariar previamente su contenido, dependencias y necesidad de conservación.

## 13. Protocolo obligatorio para asistentes y agentes

Antes de comenzar cualquier tarea de desarrollo:

1. Leer este documento.
2. Explicar brevemente qué regla funcional se pretende satisfacer.
3. Proponer la solución mínima.
4. Identificar qué archivos se modificarán.
5. Señalar riesgos sobre funcionalidades existentes.
6. Respetar estrictamente el alcance autorizado.

Durante la implementación:

- No utilizar subagentes salvo autorización.
- No realizar refactorizaciones ajenas.
- No ejecutar pruebas extensas repetidamente sin justificación.
- No iniciar trabajos adicionales al completar la tarea.
- Detenerse ante errores inesperados y reportar la causa.

Al finalizar, informar los cambios y las pruebas ejecutadas sin declarar como validado aquello que no se comprobó.

## 14. Autoridad de las decisiones funcionales

Las decisiones funcionales expresamente aprobadas por la propietaria del sistema prevalecen sobre preferencias arquitectónicas, recomendaciones genéricas y diseños anteriores que entren en conflicto con ellas.

Si existe contradicción entre el código actual y este documento, NO debe asumirse automáticamente que el código es correcto.

El agente debe señalar la contradicción y solicitar una decisión antes de cambiar el comportamiento.

Este documento no autoriza por sí mismo cambios de código, migraciones, eliminaciones ni modificaciones de datos.

## 15. Criterio definitivo de éxito

El sistema será correcto cuando:

**EL CLIENTE PAGUE, EL SISTEMA REGISTRE EXACTAMENTE ESE DINERO Y EL PLAN VIGENTE SE ADAPTE AUTOMÁTICAMENTE A LA REALIDAD DEL PAGO.**

Sin calendarios originales que prevalezcan indebidamente.

Sin pagos ficticios.

Sin alterar saldos financieros.

Sin impedir personalizaciones válidas.

Sin romper anulaciones.

Sin complejidad innecesaria.

**La simplicidad funcional, la integridad financiera y la estabilidad del sistema son requisitos obligatorios, no preferencias opcionales.**