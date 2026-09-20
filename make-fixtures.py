# -*- coding: utf-8 -*-
"""生成回归测试样本（复刻真实业务表结构，全部为虚构人名，不含任何真实人员信息）。
输出到 test-fixtures/，可入库。改动识别规则后可用本脚本重新生成样本：
    python make-fixtures.py      （需 openpyxl / xlwt）

复刻的结构特征（来自真实「资材部-9月-6休1排班表」）：
  行0     标题：资材部-9月-6休1排班表（合并单元格）
  行1     负责人 | | 工号 | 日期 | <Excel序列日期 46235...>   ← 日期列在此行
  行2     | | | 星期\n姓名 | <Excel序列日期 ...>              ← 姓名列在此行（合并双行表头）
  行3     姜雄（占位，无排班）→ 用虚构人名
  行4..   数据：工号 | 姓名 | 休/班/白班/夜班
"""
import os
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'test-fixtures')
os.makedirs(OUT, exist_ok=True)

# 虚构名单（结构与真实表一致：20 人，除气/转码两部门）
NAMES_A = ['甲一', '乙二', '丙三', '丁四', '戊五', '己六', '庚七', '辛八', '壬九', '癸十']
NAMES_B = ['子甲', '丑乙', '寅丙', '卯丁', '辰戊', '巳己', '午庚', '未辛', '申壬', '酉癸']

START = date(2026, 9, 1)
DAYS = 30


def sched_row(kind, i, day):
    """返回单元格文本：复刻真实表的写法（休 / 班 / 白班 / 夜班）"""
    if (day + i) % 7 == 0:
        return '休'
    if kind == 'plain':
        return '班'
    # 转班表：1-20 日白班、21-30 日夜班
    return '白班' if day <= 20 else '夜班'


def write_xlsx_two_row_header(path, use_serial=True, date_fmt=True):
    """复刻真实结构：双行表头 + 姓名在第二行 + Excel 序列日期"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = '6休1排班计划表-A'
    ws['A1'] = '资材部-9月-6休1排班表'
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=DAYS + 4)
    ws['A2'], ws['C2'], ws['D2'] = '负责人', '工号', '日期'
    ws['D3'] = '星期\n姓名'
    ws['D3'].alignment = Alignment(wrap_text=True)
    names = NAMES_A + NAMES_B
    for i in range(DAYS):
        d = START + timedelta(days=i)
        ws.cell(row=2, column=5 + i, value=d)
        ws.cell(row=3, column=5 + i, value=d)
    # 第 4 行：占位人员（无排班）
    ws.cell(row=4, column=4, value=names[0])
    for r, nm in enumerate(names, start=5):
        i = r - 5
        ws.cell(row=r, column=3, value=2610000 + i)
        ws.cell(row=r, column=4, value=nm)
        for i2 in range(DAYS):
            ws.cell(row=r, column=5 + i2, value=sched_row('x', i, i2 + 1))
    for i in range(DAYS):
        d = START + timedelta(days=i)
        c1 = ws.cell(row=2, column=5 + i)
        c2 = ws.cell(row=3, column=5 + i)
        if not use_serial:
            c1.value = '%d/%d' % (d.month, d.day)
            c2.value = '%d/%d' % (d.month, d.day)
            c1.number_format = 'General'
            c2.number_format = 'General'
        elif date_fmt:
            c1.number_format = 'm/d'
            c2.number_format = 'm/d'
        else:  # 测试「无日期格式的裸序列号」回退路径
            c1.number_format = 'General'
            c2.number_format = 'General'
    wb.save(path)
    print('  ✓', os.path.relpath(path, HERE))


def write_xlsx_single_header(path):
    """通用单行表头：姓名 + 8/1 文本日期（第 2 种常见形态）"""
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = 'Sheet1'
    ws.append(['序号', '姓名', '部门', '班次规则'] + ['%d/%d' % ((START + timedelta(days=i)).month,
                                                              (START + timedelta(days=i)).day) for i in range(DAYS)])
    ws.append(['星期', '', '', ''] + ['周' + '日一二三四五六'[(START + timedelta(days=i)).weekday() + 1 if
                                                            (START + timedelta(days=i)).weekday() < 6 else 0]
                                      for i in range(DAYS)])
    for i, nm in enumerate(NAMES_A):
        ws.append([i + 1, nm, '除气', '月轮转'] + [sched_row('x', i, d + 1) for d in range(DAYS)])
    for i, nm in enumerate(NAMES_B):
        ws.append([i + 1, nm, '转码', '固定白班'] + [sched_row('plain', i, d + 1) for d in range(DAYS)])
    wb.save(path)
    print('  ✓', os.path.relpath(path, HERE))


def write_xls_two_row_header(path):
    """BIFF8 (.xls)：双行表头 + 姓名在第二行 + 真日期格式"""
    import xlwt
    wb = xlwt.Workbook(encoding='utf-8')
    ws = wb.add_sheet('6休1排班计划表-A')
    date_style = xlwt.XFStyle()
    date_style.num_format_str = 'M/D'
    ws.write_merge(0, 0, 0, DAYS + 3, '资材部-9月-6休1排班表')
    ws.write(1, 0, '负责人')
    ws.write(1, 2, '工号')
    ws.write(1, 3, '日期')
    ws.write(2, 3, '星期\n姓名')
    names = NAMES_A + NAMES_B
    for i in range(DAYS):
        d = START + timedelta(days=i)
        # xlwt 需要用 Excel 序列号 + 日期格式
        ser = (d - date(1899, 12, 30)).days
        ws.write(1, 4 + i, ser, date_style)
        ws.write(2, 4 + i, ser, date_style)
    ws.write(3, 3, names[0])
    for r, nm in enumerate(names, start=4):
        i = r - 4
        ws.write(r, 2, 2610000 + i)
        ws.write(r, 3, nm)
        for i2 in range(DAYS):
            ws.write(r, 4 + i2, sched_row('x', i, i2 + 1))
    wb.save(path)
    print('  ✓', os.path.relpath(path, HERE))


def csv_cell(v):
    v = str(v)
    return '"' + v.replace('"', '""') + '"' if (',' in v or '"' in v or '\n' in v or '\r' in v) else v


def write_csv_from_business(path):
    """模拟「Excel 另存 CSV」：序列日期 + 双行表头（真实反馈场景）"""
    lines = []
    lines.append(','.join(['资材部-9月-6休1排班表']))
    lines.append(','.join(['负责人', '', '工号', '日期'] + [str((START + timedelta(days=i) - date(1899, 12, 30)).days)
                                                          for i in range(DAYS)]))
    lines.append(','.join(['', '', '', csv_cell('星期\n姓名')] + [str((START + timedelta(days=i) - date(1899, 12, 30)).days)
                                                                for i in range(DAYS)]))
    names = NAMES_A + NAMES_B
    lines.append(','.join(['', '', '', names[0]] + [''] * DAYS))
    for i, nm in enumerate(names):
        lines.append(','.join(['', '', str(2610000 + i), nm] + [sched_row('x', i, d + 1) for d in range(DAYS)]))
    txt = '\r\n'.join(lines)
    with open(path, 'wb') as f:
        f.write(txt.encode('gbk', errors='replace'))
    print('  ✓', os.path.relpath(path, HERE), '(GBK)')


if __name__ == '__main__':
    print('生成合成测试样本 →', OUT)
    write_xlsx_two_row_header(os.path.join(OUT, '排班表_双行表头_序列日期.xlsx'))
    write_xlsx_two_row_header(os.path.join(OUT, '排班表_双行表头_无日期格式.xlsx'), date_fmt=False)
    write_xlsx_two_row_header(os.path.join(OUT, '排班表_双行表头_文本日期.xlsx'), use_serial=False)
    write_xlsx_single_header(os.path.join(OUT, '排班表_单行表头_文本日期.xlsx'))
    write_xls_two_row_header(os.path.join(OUT, '排班表_双行表头.xls'))
    write_csv_from_business(os.path.join(OUT, '排班表_双行表头.csv'))
    print('完成')
