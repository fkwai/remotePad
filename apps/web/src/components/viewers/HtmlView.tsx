export function HtmlView({ content }: { content: string }) {
  return <iframe className="html-frame" sandbox="" srcDoc={content} title="HTML preview" />;
}
