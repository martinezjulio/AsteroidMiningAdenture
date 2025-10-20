#!/usr/bin/env python3
"""
Verify demonstrator style+color constraints in a timeline JSON file.
Usage: python3 verify_demonstrator_constraints.py [timeline_file.json]
"""

import json
import sys

def verify_timeline(timeline_path):
    """Verify demonstrator constraints in a timeline file."""
    
    with open(timeline_path, 'r') as f:
        timeline = json.load(f)
    
    # Extract demonstrators by session
    sessions = {}
    all_demos = {}  # Track all demonstrators globally
    
    def process_stage(stage, sess_idx):
        """Process a single stage to extract demonstrator info."""
        # Check watch/indicate stages
        if 'demonstrator' in stage and stage['demonstrator']:
            demo = stage['demonstrator']
            demo_id = demo.get('demonstrator_global_index')
            if demo_id is not None:
                info = {
                    'style': demo.get('demonstrator_style'),
                    'color': demo.get('demonstrator_color'),
                    'type': demo.get('demonstrator_type')
                }
                if sess_idx not in sessions:
                    sessions[sess_idx] = {}
                sessions[sess_idx][demo_id] = info
                
                # Track globally
                combo = f"{info['style']}:{info['color']}"
                if demo_id in all_demos:
                    if all_demos[demo_id] != combo:
                        return f"Demo {demo_id} has inconsistent assignment: {all_demos[demo_id]} vs {combo}"
                else:
                    all_demos[demo_id] = combo
        
        # Check choice stages
        for key in ['demonstrator1', 'demonstrator2']:
            if key in stage and stage[key]:
                demo = stage[key]
                demo_id = demo.get('demonstrator_global_index')
                if demo_id is not None:
                    info = {
                        'style': demo.get('demonstrator_style'),
                        'color': demo.get('demonstrator_color'),
                        'type': demo.get('demonstrator_type')
                    }
                    if sess_idx not in sessions:
                        sessions[sess_idx] = {}
                    sessions[sess_idx][demo_id] = info
                    
                    # Track globally
                    combo = f"{info['style']}:{info['color']}"
                    if demo_id in all_demos:
                        if all_demos[demo_id] != combo:
                            return f"Demo {demo_id} has inconsistent assignment: {all_demos[demo_id]} vs {combo}"
                    else:
                        all_demos[demo_id] = combo
        
        return None
    
    # Traverse timeline
    errors = []
    for item in timeline:
        if isinstance(item, list):
            for stage in item:
                if isinstance(stage, list):
                    for substage in stage:
                        sess_idx = substage.get('session_index')
                        if sess_idx and sess_idx > 0:  # Skip practice
                            err = process_stage(substage, sess_idx)
                            if err:
                                errors.append(err)
                else:
                    sess_idx = stage.get('session_index')
                    if sess_idx and sess_idx > 0:
                        err = process_stage(stage, sess_idx)
                        if err:
                            errors.append(err)
    
    # Verify constraints
    print('=' * 60)
    print('DEMONSTRATOR CONSTRAINT VERIFICATION')
    print('=' * 60)
    print(f'\nTimeline: {timeline_path}')
    print(f'Sessions found: {len(sessions)}')
    print(f'Unique demonstrators: {len(all_demos)}')
    
    all_valid = True
    
    # Check for global uniqueness
    print('\n--- Global Uniqueness Check ---')
    combo_to_demos = {}
    for demo_id, combo in all_demos.items():
        if combo not in combo_to_demos:
            combo_to_demos[combo] = []
        combo_to_demos[combo].append(demo_id)
    
    for combo, demo_ids in combo_to_demos.items():
        if len(demo_ids) > 1:
            print(f'❌ ERROR: Combo {combo} used by multiple demos: {demo_ids}')
            all_valid = False
            errors.append(f"Combo {combo} used by {demo_ids}")
    
    if not errors:
        print('✓ All demonstrators have globally unique style+color combinations')
    
    # Check session-level constraints
    print('\n--- Session-Level Constraint Check ---')
    for sess_idx in sorted(sessions.keys()):
        demos = sessions[sess_idx]
        print(f'\nSession {sess_idx}: {len(demos)} demonstrators')
        
        styles_used = set()
        colors_used = set()
        
        for demo_id, info in demos.items():
            print(f'  Demo {demo_id}: {info["style"]}/{info["color"]} ({info["type"]})')
            
            if info['style'] in styles_used:
                error_msg = f'Session {sess_idx}: Duplicate style {info["style"]}'
                print(f'    ❌ ERROR: {error_msg}')
                errors.append(error_msg)
                all_valid = False
            styles_used.add(info['style'])
            
            if info['color'] in colors_used:
                error_msg = f'Session {sess_idx}: Duplicate color {info["color"]}'
                print(f'    ❌ ERROR: {error_msg}')
                errors.append(error_msg)
                all_valid = False
            colors_used.add(info['color'])
        
        if len(demos) == len(styles_used) and len(demos) == len(colors_used):
            print(f'  ✓ All {len(demos)} demonstrators have unique styles AND colors')
    
    # Final result
    print('\n' + '=' * 60)
    if all_valid and not errors:
        print('✅ ALL CONSTRAINTS SATISFIED!')
        print('=' * 60)
        return 0
    else:
        print('❌ CONSTRAINT VIOLATIONS FOUND:')
        for error in set(errors):  # Use set to avoid duplicates
            print(f'  - {error}')
        print('=' * 60)
        return 1

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 verify_demonstrator_constraints.py <timeline_file.json>")
        sys.exit(1)
    
    timeline_path = sys.argv[1]
    try:
        exit_code = verify_timeline(timeline_path)
        sys.exit(exit_code)
    except FileNotFoundError:
        print(f"Error: File not found: {timeline_path}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {timeline_path}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

