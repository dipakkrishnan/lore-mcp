# dmgbuild settings (APP-291): Lore on the left, Applications on the right, the drag picture behind them.
# dmg.sh passes app, background and icon with -D.
import os.path

application = defines["app"]  # noqa: F821
format = "ULFO"
files = [application]
symlinks = {"Applications": "/Applications"}
badge_icon = None
icon = defines["icon"]  # noqa: F821
background = defines["background"]  # noqa: F821
hide_extensions = [os.path.basename(application)]
icon_locations = {os.path.basename(application): (180, 236), "Applications": (480, 236)}
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
arrange_by = None
icon_size = 128
text_size = 13
