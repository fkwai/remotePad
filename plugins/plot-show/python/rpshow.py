'''RemotePad Plotly show hook (plot-show plugin).

Redirects fig.show() to an interactive HTML tab in the RemotePad Editor.
Plots are stored per terminal under ~/.remotepad/plots/<termId>/.
'''
from __future__ import annotations

import json
import os
import pathlib
import re
import time
import urllib.error
import urllib.request

_installed=False


def _termId():
  return os.environ.get('REMOTEPAD_TERM_ID') or 'orphan'


def _outDir():
  root=pathlib.Path(os.environ.get(
    'REMOTEPAD_PLOT_DIR',
    pathlib.Path.home()/'.remotepad'/'plots',
  ))
  return root/_termId()


def install():
  '''Redirect plotly Figure.show / plotly.io.show to RemotePad.'''
  global _installed
  if _installed:
    return
  try:
    import plotly.io as pio
    from plotly.basedatatypes import BaseFigure
  except ImportError:
    return

  def _show(fig,*args,**kwargs):
    show(fig)

  pio.show=_show
  BaseFigure.show=lambda self,*a,**k: _show(self,*a,**k)
  _installed=True


def show(fig):
  '''Write a Plotly figure to HTML and open it in the RemotePad Editor.'''
  outDir=_outDir()
  outDir.mkdir(parents=True,exist_ok=True)
  title=_figTitle(fig)
  stamp=time.strftime('%H%M%S')
  safe=re.sub(r'[^a-zA-Z0-9._-]+','_',title)[:40] or 'plot'
  out=outDir/f'{stamp}-{safe}.html'
  # Prefer CDN so files stay smaller; fall back if plotly version lacks the kw.
  try:
    fig.write_html(str(out),include_plotlyjs='cdn',full_html=True)
  except TypeError:
    fig.write_html(str(out),include_plotlyjs='cdn')
  _open(out,title=title)
  print(f'opened {out}')


def _figTitle(fig):
  try:
    layout=getattr(fig,'layout',None)
    title=getattr(layout,'title',None)
    if title is None:
      return 'plot'
    if isinstance(title,str) and title.strip():
      return title.strip()
    text=getattr(title,'text',None)
    if isinstance(text,str) and text.strip():
      return text.strip()
  except Exception:
    pass
  return 'plot'


def _resolveApi():
  env=os.environ.get('REMOTEPAD_URL')
  if env:
    return env.rstrip('/')
  runtime=pathlib.Path.home()/'.remotepad'/'runtime.json'
  try:
    data=json.loads(runtime.read_text(encoding='utf-8'))
    url=data.get('url')
    if isinstance(url,str) and url.strip():
      return url.rstrip('/')
  except Exception:
    pass
  return 'http://127.0.0.1:3847'


def _open(path: pathlib.Path,title: str='plot'):
  api=_resolveApi()
  body=json.dumps({
    'path':str(path.resolve()),
    'termId':_termId(),
    'title':title,
  }).encode()
  req=urllib.request.Request(
    f'{api}/api/ui/open',
    data=body,
    headers={'Content-Type':'application/json'},
    method='POST',
  )
  try:
    with urllib.request.urlopen(req,timeout=5) as res:
      res.read()
  except urllib.error.URLError as err:
    raise SystemExit(
      f'could not reach RemotePad at {api} ({err})\n'
      'keep the browser UI open, or set REMOTEPAD_URL'
    ) from err
