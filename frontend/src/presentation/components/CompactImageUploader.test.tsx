import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CompactImageUploaderView } from './CompactImageUploader';

describe('CompactImageUploaderView', () => {
  it('offers rear-camera capture and selection without uploading automatically', () => {
    const html = renderToStaticMarkup(<CompactImageUploaderView label="Casa/local" capture="environment" onChange={vi.fn()} />);
    expect(html).toContain('capture="environment"');
    expect(html).toContain('Tomar / seleccionar foto');
    expect(html).not.toContain('Guardar foto');
  });

  it('shows a preview and repeat action before confirmation', () => {
    const photo = new File(['photo'], 'home.jpg', { type: 'image/jpeg' });
    const html = renderToStaticMarkup(<CompactImageUploaderView label="Casa/local" file={photo} preview="blob:preview" onChange={vi.fn()} />);
    expect(html).toContain('Vista previa de la casa o local');
    expect(html).toContain('blob:preview');
    expect(html).toContain('Repetir / seleccionar otra');
  });

  it('uses replacement wording when an existing property photo is being updated', () => {
    const html = renderToStaticMarkup(<CompactImageUploaderView label="Actualizar fotografía" selectLabel="Seleccionar nueva fotografía" onChange={vi.fn()} />);
    expect(html).toContain('Actualizar fotografía');
    expect(html).toContain('Seleccionar nueva fotografía');
    expect(html).not.toContain('Tomar / seleccionar foto');
  });
});
