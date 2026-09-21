import { rawUrl } from '../../api';

export function ImageView({ path, bust }: { path: string; bust?: number }) {
  const src = bust ? `${rawUrl(path)}&t=${bust}` : rawUrl(path);
  return (
    <div className="image-view">
      <img key={src} src={src} alt={path} />
    </div>
  );
}
