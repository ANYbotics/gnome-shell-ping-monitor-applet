#!/bin/bash
##################################################################################
#    This file is part of Ping Monitor Gnome extension.
#    Apt Update Indicator is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#    Apt Update Indicator is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#    You should have received a copy of the GNU General Public License
#    along with System Monitor.  If not, see <http://www.gnu.org/licenses/>.
#    Copyright 2019 Samuel Bachmann, sbachmann@anybotics.com.
##################################################################################

############
#          #
#   Ping   #
#          #
############

ADDRESS=$1
COUNT=$2
DEADLINE=$3
INTERVAL=$4

ping -c ${COUNT} -w ${DEADLINE} -i ${INTERVAL} ${ADDRESS}
