November 2025 site design tweaks

The site generation script build_static.py creates a site readu for dpeloymet and places it into /dist
It currently takes it's designs from the app we have built. 

## Changes to core homepage content 
I want to move away from listing all images on the homepage. 

I want to have three sections on the homepage:

- random images 
- rolls 
- years 

If possible I want the random section to use js to randomly show 15 images from the collection in that section. If we can't do it on the static site withough hitting the db, don't create that section yet. 

For the rolls follow the design that you can find in 
- 


## Changes to Top level navigation 

Top level navivation should have a link to:

- /rolls - a page listing all rolls 
- /years - a pages listing all years 
- /about - leading to an about.html page - which I will populate later 



## New major section - years 

We have a rolls page that links to all rolls, we need to do similar for years 