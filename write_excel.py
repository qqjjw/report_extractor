"""Write raw selected cells using the supplied runtime. No inspection or source files."""
import io
import json
import sys
import xlsxwriter

def write_excel(filename, data):
    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {'strings_to_formulas': False, 'strings_to_urls': False})
    sheet = book.add_worksheet('선택한 표')
    sheet.hide_gridlines(2)
    formats = {}
    def cell_format(style):
        key = json.dumps(style, sort_keys=True)
        if key not in formats:
            font = style.get('font', {})
            properties = {'num_format': '@', 'text_wrap': True}
            for source, target in [('name', 'font_name'), ('size', 'font_size'), ('color', 'font_color'), ('bold', 'bold'), ('italic', 'italic')]:
                if source in font:
                    properties[target] = font[source]
            if style.get('fill'):
                properties.update(bg_color=style['fill'], pattern=1)
            if style.get('horizontalAlignment'):
                properties['align'] = style['horizontalAlignment']
            if style.get('verticalAlignment'):
                properties['valign'] = {'center': 'vcenter'}.get(style['verticalAlignment'], style['verticalAlignment'])
            for edge, border in style.get('borders', {}).items():
                properties[edge] = {'thin': 1, 'medium': 2, 'dashed': 3, 'dotted': 4, 'double': 6}[border['style']]
                if border.get('color'):
                    properties[edge + '_color'] = border['color']
            formats[key] = book.add_format(properties)
        return formats[key]
    for row, height in data.get('rowHeights', []):
        sheet.set_row(row, height)
    for col, width in data.get('columnWidths', []):
        sheet.set_column_pixels(col, col, width)
    for cell in data['cells']:
        row, col = cell['row'], cell['col']
        rs, cs = cell.get('rs', 1), cell.get('cs', 1)
        fmt = cell_format(cell.get('format', {}))
        if rs > 1 or cs > 1:
            sheet.merge_range(row, col, row + rs - 1, col + cs - 1, '', fmt)
        # Explicit string write preserves commas, parentheses, leading '=' and zeroes.
        if cell['text']:
            sheet.write_string(row, col, cell['text'], fmt)
        else:
            sheet.write_blank(row, col, None, fmt)
    book.close()
    with open(filename, 'xb') as output:
        output.write(buffer.getvalue())

if __name__ == '__main__':
    try:
        write_excel(sys.argv[1], json.load(sys.stdin.buffer))
        print(json.dumps({'saved': True}))
    except FileExistsError:
        print(json.dumps({'saved': False, 'reason': 'file_exists'}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'saved': False, 'reason': 'write_failed'}))
        sys.exit(1)
