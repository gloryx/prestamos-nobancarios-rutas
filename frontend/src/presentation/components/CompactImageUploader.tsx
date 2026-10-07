import { useEffect, useState, type ReactElement } from 'react';
type Props = { label: string; required?: boolean; file?: File; onChange: (file?: File) => void; allowRemove?: boolean; capture?: 'user' | 'environment'; selectLabel?: string };
export function CompactImageUploader({ label, required, file, onChange, allowRemove = true, capture, selectLabel }: Props): ReactElement {
  const [preview, setPreview] = useState<string>();
  useEffect(() => { if (!file) { setPreview(undefined); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  return <CompactImageUploaderView {...{ label, required, file, onChange, allowRemove, capture, selectLabel, preview }} />;
}

export function CompactImageUploaderView({ label, required, file, onChange, allowRemove = true, capture, selectLabel, preview }: Props & { preview?: string }): ReactElement {
  return <div className="image-uploader"><strong>{label}{required ? ' *' : ''}</strong><div className="image-uploader__body">{preview ? <img src={preview} alt="Vista previa de la casa o local" /> : <span>JPEG, PNG o WEBP · máximo 5 MB</span>}<label className="button button--secondary">{file ? 'Repetir / seleccionar otra' : selectLabel ?? 'Tomar / seleccionar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" capture={capture} hidden onChange={(event) => onChange(event.target.files?.[0])} /></label>{file && allowRemove && <button type="button" className="button button--secondary" onClick={() => onChange(undefined)}>Quitar</button>}</div></div>;
}
