import psutil
import os

def system_memory_check():
    """First, let's see your actual system memory"""
    mem = psutil.virtual_memory()
    print("=== SYSTEM MEMORY INFO ===")
    print(f"Total RAM: {mem.total / 1024**3:.2f} GB")
    print(f"Available: {mem.available / 1024**3:.2f} GB") 
    print(f"Used: {mem.used / 1024**3:.2f} GB")
    print(f"Percentage used: {mem.percent}%")
    print()

def debug_all_chrome_processes():
    """Show EVERY process with 'chrome' in the name"""
    print("=== ALL PROCESSES WITH 'CHROME' ===")
    total_mb = 0
    count = 0
    
    for proc in psutil.process_iter(['pid', 'name', 'memory_info', 'cmdline']):
        try:
            name = proc.info.get('name', '')
            if name and 'chrome' in name.lower():
                mem_info = proc.info.get('memory_info')
                if mem_info:
                    mem_mb = mem_info.rss / 1024 / 1024
                    total_mb += mem_mb
                    count += 1
                    
                    # Get command line to see what type of process
                    cmdline = proc.info.get('cmdline', [])
                    cmd_summary = ' '.join(cmdline[:3]) if cmdline else 'No cmdline'
                    
                    print(f"PID: {proc.info['pid']:6} | Name: {name:25} | RAM: {mem_mb:7.1f} MB | CMD: {cmd_summary[:50]}")
        except:
            continue
    
    print(f"\nTOTAL: {total_mb:.1f} MB ({total_mb/1024:.2f} GB) from {count} processes")
    print("=" * 80)
    return total_mb, count

def check_memory_units():
    """Make sure we're not mixing up units"""
    print("=== MEMORY UNIT CHECK ===")
    
    # Get one Chrome process and check its memory in different units
    for proc in psutil.process_iter(['pid', 'name', 'memory_info']):
        try:
            name = proc.info.get('name', '')
            if name and 'chrome' in name.lower():
                mem = proc.info.get('memory_info')
                if mem:
                    print(f"Process: {name} (PID: {proc.info['pid']})")
                    print(f"RSS in bytes: {mem.rss:,}")
                    print(f"RSS in KB: {mem.rss/1024:.1f}")
                    print(f"RSS in MB: {mem.rss/1024/1024:.1f}")
                    print(f"RSS in GB: {mem.rss/1024/1024/1024:.3f}")
                    break
        except:
            continue
    print()

def compare_with_top():
    """Compare with what 'top' would show"""
    print("=== TOP 10 MEMORY USERS (for comparison) ===")
    
    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'memory_info']):
        try:
            mem_info = proc.info.get('memory_info')
            if mem_info:
                processes.append((proc.info['name'], mem_info.rss / 1024 / 1024, proc.info['pid']))
        except:
            continue
    
    # Sort by memory usage
    processes.sort(key=lambda x: x[1], reverse=True)
    
    for i, (name, mem_mb, pid) in enumerate(processes[:10], 1):
        print(f"{i:2}. {name:25} | {mem_mb:7.1f} MB | PID: {pid}")
    print()

def minimal_chrome_check():
    """Ultra-simple Chrome memory check"""
    print("=== MINIMAL CHROME CHECK ===")
    total = 0
    
    # Just count RSS for processes with exact name matches
    exact_names = ['Google Chrome', 'chrome', 'Chromium', 'Google Chrome Helper']
    
    for proc in psutil.process_iter(['name', 'memory_info']):
        try:
            name = proc.info.get('name', '')
            if name in exact_names:
                mem = proc.info.get('memory_info')
                if mem:
                    mem_mb = mem.rss / 1024 / 1024
                    total += mem_mb
                    print(f"{name}: {mem_mb:.1f} MB")
        except:
            continue
    
    print(f"Total Chrome (exact names): {total:.1f} MB")
    print()

def cross_check_with_chrome_task_manager():
    """Instructions for manual verification"""
    print("=== MANUAL VERIFICATION STEPS ===")
    print("1. Open Chrome")
    print("2. Press Shift+Esc to open Chrome Task Manager")
    print("3. Compare the total memory shown there with our readings")
    print("4. Also check Activity Monitor (Mac) or Task Manager (Windows)")
    print()

if __name__ == "__main__":
    print("CHROME MEMORY DEBUGGING TOOL")
    print("=" * 50)
    
    # Step 1: Check system memory
    system_memory_check()
    
    # Step 2: Show all Chrome processes
    total_mb, count = debug_all_chrome_processes()
    
    # Step 3: Check if we're using wrong units
    check_memory_units()
    
    # Step 4: Compare with top processes
    compare_with_top()
    
    # Step 5: Try minimal approach
    minimal_chrome_check()
    
    # Step 6: Manual verification instructions
    cross_check_with_chrome_task_manager()
    
    # Final analysis
    print("=== ANALYSIS ===")
    if total_mb > 4096:  # More than 4GB
        print("🚨 ERROR: Chrome memory reading is impossibly high!")
        print("Possible causes:")
        print("- Including non-Chrome processes")
        print("- Double-counting shared memory")
        print("- Unit conversion error")
        print("- System reporting error")
    else:
        print("✅ Chrome memory reading seems reasonable")