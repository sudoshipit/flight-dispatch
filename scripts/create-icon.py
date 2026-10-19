from PIL import Image, ImageDraw
from pathlib import Path

root = Path(__file__).resolve().parent.parent
image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((4, 4, 252, 252), radius=54, fill='#1b2925', outline='#8caa72', width=5)
draw.ellipse((46, 46, 210, 210), outline='#3b503b', width=2)
draw.polygon([(126, 45), (139, 45), (145, 113), (213, 157), (213, 174), (145, 151), (143, 190), (164, 207), (164, 218), (132, 207), (100, 218), (100, 207), (121, 190), (119, 151), (51, 174), (51, 157), (119, 113)], fill='#b7e48a')
image.save(root / 'assets' / 'icon.png')
image.save(root / 'assets' / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
