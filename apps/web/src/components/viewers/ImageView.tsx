import { rawUrl } from '../../api';

export function ImageView({ path }: { path: string }) {
  return (
    <div className="image-view">
      <img src={rawUrl(path)} alt={path} />
    </div>
  );
}
