BASE_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Tag Discovery</title>
    <style>
        * {{ box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; padding: 20px; background: #f5f5f5; color: #333;
        }}
        .container {{ max-width: 1400px; margin: 0 auto; }}
        h1 {{ color: #1a1a1a; margin-bottom: 10px; }}
        h2 {{ color: #444; border-bottom: 2px solid #ddd; padding-bottom: 10px; }}
        nav {{ background: #333; padding: 15px 20px; margin: -20px -20px 20px; }}
        nav a {{ color: white; text-decoration: none; margin-right: 20px; font-weight: 500; }}
        nav a:hover {{ text-decoration: underline; }}
        nav a.active {{ border-bottom: 2px solid #4CAF50; }}
        .stats {{ background: white; padding: 15px 20px; border-radius: 8px; margin-bottom: 20px;
                  display: flex; gap: 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .stat {{ text-align: center; }}
        .stat-value {{ font-size: 28px; font-weight: bold; color: #4CAF50; }}
        .stat-label {{ font-size: 12px; color: #666; text-transform: uppercase; }}
        .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }}
        .card {{ background: white; border-radius: 8px; padding: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .card:hover {{ box-shadow: 0 4px 12px rgba(0,0,0,0.15); }}
        .card h3 {{ margin: 0 0 8px; font-size: 16px; }}
        .card .count {{ color: #666; font-size: 13px; }}
        .card .category {{
            display: inline-block; padding: 2px 8px; border-radius: 12px;
            font-size: 11px; text-transform: uppercase; margin-bottom: 8px;
        }}
        .category-theme {{ background: #e3f2fd; color: #1565c0; }}
        .category-entity_person, .category-people {{ background: #fce4ec; color: #c2185b; }}
        .category-entity_place, .category-places {{ background: #e8f5e9; color: #2e7d32; }}
        .category-entity_org {{ background: #fff3e0; color: #ef6c00; }}
        .category-entity_date, .category-dates {{ background: #f3e5f5; color: #7b1fa2; }}
        .category-event {{ background: #ffebee; color: #c62828; }}
        .category-setting {{ background: #e0f7fa; color: #00838f; }}
        .category-activity {{ background: #fff8e1; color: #ff8f00; }}
        .category-time_period {{ background: #efebe9; color: #5d4037; }}
        .category-other {{ background: #eceff1; color: #546e7a; }}
        .thumbnails {{ display: flex; gap: 5px; margin-top: 10px; }}
        .thumbnails img {{ width: 50px; height: 50px; object-fit: cover; border-radius: 4px; }}
        .btn {{
            padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;
            font-size: 14px; text-decoration: none; display: inline-block;
        }}
        .btn-primary {{ background: #4CAF50; color: white; }}
        .btn-primary:hover {{ background: #45a049; }}
        .btn-danger {{ background: #f44336; color: white; }}
        .btn-danger:hover {{ background: #da190b; }}
        .btn-secondary {{ background: #757575; color: white; }}
        .form-group {{ margin-bottom: 15px; }}
        .form-group label {{ display: block; margin-bottom: 5px; font-weight: 500; }}
        .form-group input, .form-group select {{
            width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;
        }}
        .tag-list {{ display: flex; flex-wrap: wrap; gap: 8px; }}
        .tag {{
            display: inline-flex; align-items: center; gap: 8px;
            background: white; padding: 8px 12px; border-radius: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .tag .remove {{
            color: #999; cursor: pointer; font-size: 18px; line-height: 1;
        }}
        .tag .remove:hover {{ color: #f44336; }}
        .section {{ margin-bottom: 40px; }}
        .empty {{ color: #999; font-style: italic; padding: 20px; text-align: center; }}
        .images-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }}
        .image-card {{ background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .image-card img {{ width: 100%; height: 150px; object-fit: cover; }}
        .image-card .info {{ padding: 10px; font-size: 12px; color: #666; }}
        .modal {{
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;
        }}
        .modal.active {{ display: flex; }}
        .modal-content {{
            background: white; padding: 25px; border-radius: 8px; max-width: 500px; width: 90%;
        }}
        .modal-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }}
        .modal-close {{ font-size: 24px; cursor: pointer; color: #999; }}
        .refresh-btn {{ float: right; }}
        a {{ color: #1976d2; }}
        .filter-bar {{ background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 15px; align-items: center; }}
        .filter-bar select {{ padding: 8px; border-radius: 4px; border: 1px solid #ddd; }}
        .merge-panel {{
            background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1); border: 2px solid #4CAF50;
        }}
        .selected-terms {{
            background: #f0f8f0; padding: 10px; border-radius: 4px; margin-bottom: 15px;
            color: #2e7d32; font-weight: 500;
        }}
        .suggestion-card {{
            transition: all 0.2s ease;
        }}
        .suggestion-actions {{
            flex-wrap: wrap;
        }}
    </style>
</head>
<body>
    <nav>
        <a href="/" class="{nav_discover}">Suggestions</a>
        <a href="/curated" class="{nav_curated}">Curated Tags</a>
        <a href="/stats" class="{nav_stats}">Stats</a>
    </nav>
    <div class="container">
        {content}
    </div>
    {scripts}
</body>
</html>
"""
