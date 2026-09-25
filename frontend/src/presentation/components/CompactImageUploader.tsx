import { useEffect, useState, type ReactElement } from 'react';
type Props = { label: string; required?: boolean; file?: File; onChange: (file?: File) => void; allowRemove?: boolean };
export function CompactImageUploader({ label, required, file, onChange, allowRemove = true }: Props): ReactElement {
  const [preview, setPreview] = useState<string>();
  useEffect(() => { if (!file) { setPreview(undefined); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  return <div className="image-uploader"><strong>{label}{required ? ' *' : ''}</strong><div className="image-uploader__body">{preview ? <img src={preview} alt="Vista previa" /> : <span>JPEG, PNG o WEBP · máximo 5 MB</span>}<label className="button button--secondary">{file ? 'Cambiar' : 'Seleccionar'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => onChange(event.target.files?.[0])} /></label>{file && allowRemove && <button type="button" className="button button--secondary" onClick={() => onChange(undefined)}>Quitar</button>}</div></div>;
}
