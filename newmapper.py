import os

def generate_sitemap(startpath):
    exclude = {'.git', 'node_modules', '__pycache__', '.venv', 'dist'}
    
    with open("project_sitemap.txt", "w") as f:
        for root, dirs, files in os.walk(startpath):
            # Filter out excluded directories
            dirs[:] = [d for d in dirs if d not in exclude]
            
            level = root.replace(startpath, '').count(os.sep)
            indent = ' ' * 4 * (level)
            f.write(f'{indent}{os.path.basename(root)}/\n')
            
            sub_indent = ' ' * 4 * (level + 1)
            for file in files:
                f.write(f'{sub_indent}{file}\n')

generate_sitemap('.')
print("Sitemap generated as project_sitemap.txt")