import plotly.express as px
import random

x=[random.random() for _ in range(80)]
y=[random.random() for _ in range(80)]

fig=px.scatter(x=x,y=y,title='random (x, y)')
fig.show()
